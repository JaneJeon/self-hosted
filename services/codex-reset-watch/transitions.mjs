import { createHash } from 'node:crypto'
import { STATE_VERSION } from './store.mjs'
import { TITLE_CONFIRMED, TITLE_UNCONFIRMED } from './normalize.mjs'

// A window bound moving less than this is drift, not news. It still gets
// written to the calendar so the projection stays true, but it does not earn
// an interruption.
export const MATERIAL_SHIFT_MS = 15 * 60 * 1000

export const UID = 'codex-reset-watch@janejeon.com'

const NONE = { action: 'none' }

// Decide what one run should do.
//
// Pure: no clock, no network, no logging. `now` is passed in so a stored
// payload replays identically, which is what makes the withdrawal rules
// testable at all.
//
// Rows are evaluated top to bottom and the first match wins. The ordering is
// load-bearing in one place: a completed reset must be checked before a
// vanished signal, or a normal completion would be misread as a withdrawal.
export function decide(prior, next, { now }) {
  const nowMs = Date.parse(now)
  const base = {
    version: STATE_VERSION,
    checkedAt: now,
    trackerEtag: next.etag ?? prior?.trackerEtag ?? null,
    lastReset: prior?.lastReset ?? null,
    signal: prior?.signal ?? null,
    projection: prior?.projection ?? null,
    health: healthy(),
    lastTransition: prior?.lastTransition ?? null
  }

  // Row 0. Nothing changed upstream, so nothing can have changed here.
  if (next.notModified)
    return {
      calendar: NONE,
      telegram: null,
      health: healthy(),
      nextState: base
    }

  // Rows 1 and 2. The window could not be derived. Change nothing outside this
  // process, and do not advance the signal, so the failure stays sticky until
  // the world or the allowlist changes.
  if (next.failure) {
    const evidenceHash = hash(next.failure.evidence)
    const repeat = prior?.health?.evidenceHash === evidenceHash
    return {
      calendar: NONE,
      // A contradiction is a fact about the world: the evidence disagrees with
      // itself. That is worth telling Jane once. An unparseable string is a
      // gap in our own allowlist, which is Kuma's business, not hers.
      telegram:
        next.failure.reason === 'contradictory_window' && !repeat
          ? { type: 'contradiction', detail: next.failure.detail }
          : null,
      health: {
        ok: false,
        reason: next.failure.reason,
        detail: next.failure.detail,
        evidenceHash,
        since: repeat ? prior.health.since : now
      },
      nextState: {
        ...base,
        lastReset: next.latestReset ?? base.lastReset,
        health: {
          ok: false,
          reason: next.failure.reason,
          detail: next.failure.detail,
          evidenceHash,
          since: repeat ? prior.health.since : now
        }
      }
    }
  }

  const idChanged =
    next.latestReset && next.latestReset.id !== prior?.lastReset?.id
  const landedRegular = idChanged && next.latestReset.resetType === 'regular'

  // Row 3. A new regular reset announced at or after the signal was observed
  // is that signal completing. Completion always beats withdrawal.
  if (
    landedRegular &&
    prior?.signal &&
    Date.parse(next.latestReset.announcedAt) >=
      Date.parse(prior.signal.observedAt)
  ) {
    return {
      calendar: prior.projection
        ? { action: 'delete', projection: prior.projection }
        : NONE,
      telegram: { type: 'completed', reset: next.latestReset },
      health: healthy(),
      nextState: {
        ...base,
        lastReset: next.latestReset,
        signal: null,
        projection: null,
        lastTransition: { type: 'completed', at: now, notified: true }
      }
    }
  }

  // Row 4. A banked credit landed. Record it so it is not re-detected, and do
  // nothing else: a banked reset is not a usage reset.
  if (idChanged && !landedRegular)
    return {
      calendar: NONE,
      telegram: null,
      health: healthy(),
      nextState: { ...base, lastReset: next.latestReset }
    }

  const lastReset = next.latestReset ?? base.lastReset

  // Rows 11, 12 and 13. The signal is gone. Whether that is safe is decided
  // entirely from what was stored, never from what is missing now.
  if (prior?.signal && !next.signal) {
    const safe =
      prior.signal.kind === 'watch' &&
      prior.signal.expiresAt &&
      nowMs >= Date.parse(prior.signal.expiresAt)

    if (safe)
      return {
        calendar: prior.projection
          ? { action: 'delete', projection: prior.projection }
          : NONE,
        telegram: { type: 'withdrawn', signal: prior.signal },
        health: healthy(),
        nextState: {
          ...base,
          lastReset,
          signal: null,
          projection: null,
          lastTransition: { type: 'withdrawn', at: now, notified: true }
        }
      }

    // A scheduled_reset carries no expiry, and the tracker's own spec says a
    // passed scheduled_for does not imply completion. So nothing stored can
    // make its disappearance safe, and guessing would mean deleting an event
    // we cannot reason about.
    const detail =
      prior.signal.kind === 'scheduled'
        ? 'an announced reset vanished with no completion, and it carries no expiry that could make that safe'
        : 'a forecast vanished before its stated expiry, with no completed reset'
    const evidenceHash = hash({
      kind: prior.signal.kind,
      evidenceId: prior.signal.evidenceId
    })
    const repeat = prior.health?.evidenceHash === evidenceHash
    const health = {
      ok: false,
      reason: 'unclassifiable_disappearance',
      detail,
      evidenceHash,
      since: repeat ? prior.health.since : now
    }
    return {
      calendar: NONE,
      telegram: null,
      health,
      nextState: { ...base, lastReset, health }
    }
  }

  if (!next.signal)
    return {
      calendar: NONE,
      telegram: null,
      health: healthy(),
      nextState: { ...base, lastReset, signal: null }
    }

  const desired = projectionFor(next.signal)

  // Row 5. Nothing was being tracked and now something is.
  if (!prior?.signal)
    return {
      calendar: { action: 'create', desired },
      telegram: { type: 'upcoming', signal: next.signal },
      health: healthy(),
      nextState: {
        ...base,
        lastReset,
        signal: next.signal,
        lastTransition: { type: 'upcoming', at: now, notified: true }
      }
    }

  // Row 6. The forecast graduated into a human announcement.
  const becameConfirmed = !prior.signal.confirmed && next.signal.confirmed
  if (becameConfirmed)
    return {
      calendar: { action: 'update', desired },
      telegram: { type: 'confirmed', signal: next.signal },
      health: healthy(),
      nextState: {
        ...base,
        lastReset,
        signal: next.signal,
        lastTransition: { type: 'confirmed', at: now, notified: true }
      }
    }

  const startShift = Math.abs(
    Date.parse(next.signal.windowStartUtc) -
      Date.parse(prior.signal.windowStartUtc)
  )
  const endShift = Math.abs(
    Date.parse(next.signal.windowEndUtc) - Date.parse(prior.signal.windowEndUtc)
  )
  const moved = Math.max(startShift, endShift)

  // Row 10. The event we would write is the one already there, so no request
  // is issued at all. This is the literal reading of "unchanged state means no
  // calendar write".
  if (moved === 0 && sameProjection(prior.projection, desired))
    return {
      calendar: NONE,
      telegram: null,
      health: healthy(),
      nextState: { ...base, lastReset, signal: next.signal }
    }

  // Rows 7, 8 and 9. The projection needs rewriting. Whether that is worth an
  // interruption depends on how far the window actually moved.
  const material = moved >= MATERIAL_SHIFT_MS
  return {
    calendar: { action: 'update', desired },
    telegram: material
      ? { type: 'moved', signal: next.signal, previous: prior.signal }
      : null,
    health: healthy(),
    nextState: {
      ...base,
      lastReset,
      signal: next.signal,
      lastTransition: material
        ? { type: 'moved', at: now, notified: true }
        : { type: 'adjusted', at: now, notified: false }
    }
  }
}

export function projectionFor(signal) {
  return {
    uid: UID,
    summary: signal.confirmed ? TITLE_CONFIRMED : TITLE_UNCONFIRMED,
    startUtc: signal.windowStartUtc,
    endUtc: signal.windowEndUtc,
    // Only the best specific source URL, and nothing when there is none. The
    // observed source variant makes url optional, so this really can be null.
    description: signal.sourceUrl ?? null
  }
}

function sameProjection(a, b) {
  if (!a || !b) return false
  return (
    a.summary === b.summary &&
    a.startUtc === b.startUtc &&
    a.endUtc === b.endUtc &&
    (a.description ?? null) === (b.description ?? null)
  )
}

function healthy() {
  return {
    ok: true,
    reason: null,
    detail: null,
    evidenceHash: null,
    since: null
  }
}

// Identifies the offending evidence so a stuck failure logs every run but
// messages once.
function hash(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 16)
}
