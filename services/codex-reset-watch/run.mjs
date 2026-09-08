import { existsSync, accessSync, constants } from 'node:fs'
import { dirname } from 'node:path'
import { httpError, withRetry } from './retry.mjs'
import { fetchStatus, isTransientTrackerError } from './tracker.mjs'
import { normalize } from './normalize.mjs'
import { decide } from './transitions.mjs'
import { buildMessage } from './telegram.mjs'
import { STATE_PATH } from './store.mjs'

const HTTP_TIMEOUT_MS = 15_000

export const HEARTBEAT_VARS = {
  liveness: 'KUMA_PUSH_URL_LIVENESS',
  domain: 'KUMA_PUSH_URL_DOMAIN',
  caldav: 'KUMA_PUSH_URL_CALDAV',
  telegram: 'KUMA_PUSH_URL_TELEGRAM'
}

export function requireEnv(name) {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

// Env presence as booleans, never values. This is the sanctioned way to make
// a misconfigured deploy debuggable.
export function diagnostics(names) {
  const dir = dirname(STATE_PATH)
  const exists = existsSync(dir)
  let writable = false
  if (exists) {
    try {
      accessSync(dir, constants.W_OK)
      writable = true
    } catch {
      writable = false
    }
  }
  const env = {}
  for (const name of names) env[name] = !!process.env[name]
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    stateDir: dir,
    stateDirExists: exists,
    stateDirWritable: writable,
    env
  }
}

// One cron run.
//
// Dependencies are injected so tests can drive the whole ordering, including
// the rule that matters most: nothing pings before the domain work succeeds.
export async function run({
  logger,
  store,
  caldav,
  telegram,
  heartbeat,
  now = () => new Date(),
  dryRun = false,
  attempts
}) {
  const nowIso = now().toISOString()
  const prior = store.load()

  // Health starts pessimistic. A signal is only pushed by a step that actually
  // succeeded, so a crash halfway through leaves the rest silent rather than
  // green.
  const health = {
    liveness: false,
    domain: false,
    caldav: false,
    telegram: false
  }

  // The credential probes run every cycle, not only when there is something to
  // write. Between transitions the write path never executes, and resets are
  // about a week apart, so a dead credential would otherwise stay invisible
  // for days. Both are cheap reads with no side effects.
  let sweep = null
  try {
    sweep = await caldav.sweep()
    health.caldav = true
    logger.info(
      {
        ours: sweep.ours.length,
        strays: sweep.strays.length,
        suspects: sweep.suspects.length
      },
      'calendar swept'
    )
  } catch (err) {
    logger.error(
      { err },
      'calendar unreachable, so the projection cannot be trusted'
    )
  }

  try {
    const who = await telegram.probe()
    health.telegram = true
    logger.info({ bot: who.username }, 'telegram credential alive')
  } catch (err) {
    logger.error({ err }, 'telegram credential failed its probe')
  }

  const fetched = await withRetry(
    () => fetchStatus({ etag: prior?.trackerEtag }),
    { label: 'tracker', logger, attempts, transient: isTransientTrackerError }
  )

  let next
  if (fetched.notModified) {
    logger.info('tracker unchanged since last run')
    next = { notModified: true }
  } else {
    const normalized = normalize(fetched.data, { now: nowIso, logger })
    next = { ...normalized, etag: fetched.etag }
    logger.info(
      {
        latestResetId: next.latestReset?.id ?? null,
        signal: next.signal
          ? {
              kind: next.signal.kind,
              confirmed: next.signal.confirmed,
              window: [next.signal.windowStartUtc, next.signal.windowEndUtc]
            }
          : null,
        failure: next.failure?.reason ?? null
      },
      'tracker state'
    )
  }

  const decision = decide(prior, next, { now: nowIso })
  health.domain = decision.health.ok
  if (!decision.health.ok)
    logger.error(
      { reason: decision.health.reason, detail: decision.health.detail },
      'unclassifiable state, changing nothing outside this process'
    )

  const nextState = { ...decision.nextState }

  // Strays are reconciled whatever else happens, so "at most one active
  // projection" holds even on a run that does nothing else. This never
  // messages: it is migration cleanup, not news.
  if (sweep) {
    for (const stray of sweep.strays) {
      if (stray.href === caldav.ourHref) continue
      logger.info(
        { href: stray.href, summary: stray.summary },
        'removing stray projection'
      )
      await caldav.remove({ href: stray.href, etag: stray.etag })
    }
  }

  const mine = sweep?.ours?.[0] ?? null

  if (
    decision.calendar.action === 'create' ||
    decision.calendar.action === 'update'
  ) {
    // Reminders belong to Jane. Because this is a whole-resource write, they
    // have to be read off the existing event and carried forward, or a hand
    // added alarm dies on the next window change.
    const preservedAlarms = mine ? await caldav.alarmsFor(mine) : []
    const result = await caldav.put(decision.calendar.desired, {
      href: mine?.href,
      etag: mine?.etag,
      preservedAlarms,
      sequence: (mine?.sequence ?? 0) + 1
    })
    if (result.conflict) {
      logger.error(
        { href: result.href },
        'calendar event changed underneath us, leaving it alone rather than overwriting'
      )
      health.domain = false
      nextState.health = {
        ok: false,
        reason: 'projection_conflict',
        detail: 'the event was modified since we last read it',
        evidenceHash: null,
        since: nowIso
      }
    } else if (!result.dryRun) {
      nextState.projection = {
        ...decision.calendar.desired,
        href: result.href,
        etag: result.etag,
        sequence: (mine?.sequence ?? 0) + 1
      }
    }
  } else if (decision.calendar.action === 'delete') {
    const target = mine ?? decision.calendar.projection
    if (target?.href)
      await caldav.remove({ href: target.href, etag: target.etag })
    nextState.projection = null
  }

  if (decision.telegram) {
    await telegram.send(buildMessage(decision.telegram))
    logger.info({ transition: decision.telegram.type }, 'notification sent')
  } else {
    logger.info('no notification warranted')
  }

  // Dry run deliberately skips the save. Persisting a projection for an event
  // that was never created would make the service skip the create on the day
  // writes are switched on.
  if (dryRun) logger.info({ nextState }, 'dry run: would persist state')
  else store.save(nextState)

  health.liveness = true

  await pushHeartbeats(health, { heartbeat, logger, attempts })

  return { decision, health, nextState }
}

// Each concern gets its own signal. Collapsing them would let an unclassifiable
// state ride under a green bar, which is the failure this service exists to
// catch. Liveness fires whenever the run completes, whatever the checks found,
// because it answers a question no dependency probe can: did this run at all.
async function pushHeartbeats(health, { heartbeat, logger, attempts }) {
  let failed = false
  for (const [concern, ok] of Object.entries(health)) {
    const url = process.env[HEARTBEAT_VARS[concern]]
    if (!url) continue
    if (!ok) {
      logger.warn(
        { concern },
        'withholding heartbeat so the watchdog reports it'
      )
      failed = true
      continue
    }
    try {
      await withRetry(
        async () => {
          const resp = await fetch(url, {
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
          })
          if (!resp.ok)
            throw httpError(
              `Heartbeat returned HTTP ${resp.status}`,
              resp.status
            )
        },
        // Everything is retried, 4xx included. Uptime Kuma returns 404 while
        // it is restarting a monitor, so a 404 is not proof the monitor is
        // gone. A wasted retry on a fire-and-forget ping costs nothing.
        {
          label: `heartbeat ${concern}`,
          logger,
          attempts,
          transient: () => true
        }
      )
      logger.info({ concern }, 'heartbeat sent')
    } catch (err) {
      logger.error(
        { err, concern },
        'heartbeat failed - watchdog is blind, check the push URL'
      )
      failed = true
    }
  }
  // Non-zero so Railway's deployment view shows it, but the process still
  // drains normally: the domain work is already done and saved.
  if (failed) process.exitCode = 1
}
