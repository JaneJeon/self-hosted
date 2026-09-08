import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { HEARTBEAT_VARS, run } from './run.mjs'

const here = new URL('./', import.meta.url)

// Packaging guard. A module missing from the Dockerfile COPY list survives
// every test and crashes only in production. That exact defect shipped on
// 2026-08-28 and paged. The pre-push hook builds the image; this catches it
// one step earlier, and names the offending file.
test('the Dockerfile ships every runtime module and no test files', () => {
  const dockerfile = readFileSync(new URL('./Dockerfile', here), 'utf8')
  const copyLine = dockerfile
    .split('\n')
    .find(l => l.startsWith('COPY') && l.includes('.mjs'))
  assert.ok(copyLine, 'the Dockerfile must copy the modules explicitly')

  const copied = new Set(copyLine.match(/[\w.-]+\.mjs/g))
  const onDisk = readdirSync(new URL('.', here)).filter(
    f => f.endsWith('.mjs') && !f.endsWith('.test.mjs')
  )

  for (const file of onDisk)
    assert.ok(copied.has(file), `${file} is not in the Dockerfile COPY list`)
  for (const file of copied)
    assert.ok(onDisk.includes(file), `${file} is copied but does not exist`)
  assert.ok(
    ![...copied].some(f => f.endsWith('.test.mjs')),
    'tests must not ship in the image'
  )
})

const quietLogger = () => {
  const lines = []
  const push = level => (o, m) =>
    lines.push({ level, ...(typeof o === 'object' ? o : {}), m: m ?? o })
  return {
    lines,
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    fatal: push('fatal')
  }
}

// A harness that records every outward action in the order it happened, which
// is what the heartbeat-ordering rule actually needs to assert.
function harness({
  state = null,
  sweep = { ours: [], strays: [], suspects: [] },
  probeFails = false
} = {}) {
  const calls = []
  let saved = state
  return {
    calls,
    get saved() {
      return saved
    },
    deps: {
      logger: quietLogger(),
      store: {
        load: () => saved,
        save: s => {
          calls.push('state:save')
          saved = s
        }
      },
      caldav: {
        ourHref: '/cal/codex-reset-watch.ics',
        sweep: async () => {
          calls.push('caldav:sweep')
          return sweep
        },
        put: async () => {
          calls.push('caldav:put')
          return { href: '/cal/codex-reset-watch.ics', etag: '"new"' }
        },
        remove: async () => {
          calls.push('caldav:remove')
          return { deleted: true }
        },
        alarmsFor: async () => []
      },
      telegram: {
        probe: async () => {
          calls.push('telegram:probe')
          if (probeFails) throw new Error('bad token')
          return { username: 'bot' }
        },
        send: async () => {
          calls.push('telegram:send')
        }
      },
      now: () => new Date('2026-09-07T23:00:00.000Z'),
      attempts: 1
    }
  }
}

const trackerServer = payload => {
  const original = globalThis.fetch
  globalThis.fetch = async url => {
    const href = String(url)
    if (href.includes('codex-resets.com'))
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: '"e1"' }
      })
    return new Response('', { status: 200 })
  }
  return () => {
    globalThis.fetch = original
  }
}

const idle = JSON.parse(
  readFileSync(new URL('./fixtures/status-idle.json', here), 'utf8')
)
const watching = JSON.parse(
  readFileSync(new URL('./fixtures/status-watch.json', here), 'utf8')
)

test('the credential probes run before anything is decided, every single run', async () => {
  // Between transitions the write path never executes, and resets are about a
  // week apart. Without an unconditional probe a dead credential stays
  // invisible for days, which is exactly the failure the playbook records.
  const restore = trackerServer(idle)
  try {
    const h = harness()
    await run({ ...h.deps })
    assert.ok(h.calls.includes('caldav:sweep'))
    assert.ok(h.calls.includes('telegram:probe'))
  } finally {
    restore()
  }
})

test('an unchanged poll writes no calendar and sends no message', async () => {
  const restore = trackerServer(idle)
  try {
    const h = harness({
      state: {
        version: 1,
        lastReset: { id: 'observed-2097043464538264003', resetType: 'regular' },
        signal: null,
        projection: null,
        health: { ok: true }
      }
    })
    await run({ ...h.deps })
    assert.ok(!h.calls.includes('caldav:put'))
    assert.ok(!h.calls.includes('caldav:remove'))
    assert.ok(!h.calls.includes('telegram:send'))
  } finally {
    restore()
  }
})

test('a first credible signal writes the event and sends exactly one message', async () => {
  const restore = trackerServer(watching)
  try {
    const h = harness()
    await run({ ...h.deps })
    assert.equal(h.calls.filter(c => c === 'caldav:put').length, 1)
    assert.equal(h.calls.filter(c => c === 'telegram:send').length, 1)
  } finally {
    restore()
  }
})

test('a repeat run over the same signal sends nothing further', async () => {
  const restore = trackerServer(watching)
  try {
    const h = harness()
    await run({ ...h.deps })
    const first = h.calls.filter(c => c === 'telegram:send').length
    h.calls.length = 0
    await run({ ...h.deps })
    assert.equal(first, 1)
    assert.equal(
      h.calls.filter(c => c === 'telegram:send').length,
      0,
      'one transition means one message, not one per poll'
    )
  } finally {
    restore()
  }
})

test('every heartbeat fires strictly after the domain work is saved', async () => {
  // Ordering is the requirement, not merely that both happened. A ping sent
  // before the state is durable would report success for work that could
  // still be lost.
  const restore = trackerServer(watching)
  process.env[HEARTBEAT_VARS.liveness] = 'http://127.0.0.1:1/liveness'
  const originalFetch = globalThis.fetch
  const h = harness()
  globalThis.fetch = async (url, init) => {
    const href = String(url)
    if (href.includes('/liveness')) {
      h.calls.push('heartbeat:liveness')
      return new Response('', { status: 200 })
    }
    return originalFetch(url, init)
  }
  try {
    await run({ ...h.deps })
    const saveAt = h.calls.indexOf('state:save')
    const pingAt = h.calls.indexOf('heartbeat:liveness')
    assert.ok(saveAt >= 0, 'state must be saved')
    assert.ok(pingAt >= 0, 'liveness must fire on a healthy run')
    assert.ok(pingAt > saveAt, 'the ping must come after the save, not before')
    // The calendar and telegram work also precedes the ping.
    assert.ok(h.calls.indexOf('caldav:put') < pingAt)
    assert.ok(h.calls.indexOf('telegram:send') < pingAt)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env[HEARTBEAT_VARS.liveness]
    restore()
  }
})

test('an unclassifiable state withholds the domain heartbeat but keeps liveness', async () => {
  // Liveness answers a question no dependency probe can: did this run at all.
  // The domain signal is what goes quiet, so Kuma can say which thing broke.
  const payload = structuredClone(watching)
  payload.data.active_watch.forecast_window = 'Lands end of day'
  payload.data.active_watch.text = 'Lands end of day.'
  const restore = trackerServer(payload)
  const hits = []
  const originalFetch = globalThis.fetch
  process.env[HEARTBEAT_VARS.liveness] = 'http://127.0.0.1:1/liveness'
  process.env[HEARTBEAT_VARS.domain] = 'http://127.0.0.1:1/domain'
  globalThis.fetch = async (url, init) => {
    const href = String(url)
    if (href.includes('/liveness') || href.includes('/domain')) {
      hits.push(href.includes('/domain') ? 'domain' : 'liveness')
      return new Response('', { status: 200 })
    }
    return originalFetch(url, init)
  }
  try {
    const h = harness()
    const result = await run({ ...h.deps })
    assert.equal(result.health.domain, false)
    assert.ok(
      hits.includes('liveness'),
      'the run did happen, so liveness fires'
    )
    assert.ok(!hits.includes('domain'), 'the domain signal must go quiet')
    assert.ok(!h.calls.includes('caldav:put'), 'nothing outside is changed')
    assert.ok(!h.calls.includes('telegram:send'))
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = 0
    globalThis.fetch = originalFetch
    delete process.env[HEARTBEAT_VARS.liveness]
    delete process.env[HEARTBEAT_VARS.domain]
    restore()
  }
})

test('a dead telegram credential is reported without stopping the run', async () => {
  const restore = trackerServer(idle)
  try {
    const h = harness({ probeFails: true })
    const result = await run({ ...h.deps })
    assert.equal(result.health.telegram, false)
    assert.equal(result.health.liveness, true, 'the poll still completed')
  } finally {
    restore()
  }
})

test('strays are removed without a message, since cleanup is not news', async () => {
  const restore = trackerServer(idle)
  try {
    const h = harness({
      sweep: {
        ours: [],
        strays: [
          {
            href: '/cal/47a9d1cb.ics',
            etag: '"2"',
            summary: 'Codex Usage Limit Reset (Unconfirmed)'
          }
        ],
        suspects: []
      },
      state: {
        version: 1,
        lastReset: { id: 'observed-2097043464538264003', resetType: 'regular' },
        signal: null,
        projection: null,
        health: { ok: true }
      }
    })
    await run({ ...h.deps })
    assert.ok(h.calls.includes('caldav:remove'))
    assert.ok(!h.calls.includes('telegram:send'))
  } finally {
    restore()
  }
})

test('dry run persists nothing', async () => {
  const restore = trackerServer(watching)
  try {
    const h = harness()
    await run({ ...h.deps, dryRun: true })
    assert.ok(
      !h.calls.includes('state:save'),
      'a dry run must not record a projection it never created'
    )
  } finally {
    restore()
  }
})
