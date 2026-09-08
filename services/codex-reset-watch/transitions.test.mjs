import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, MATERIAL_SHIFT_MS } from './transitions.mjs'
import { TITLE_CONFIRMED, TITLE_UNCONFIRMED } from './normalize.mjs'

const NOW = '2026-09-07T23:00:00.000Z'
const LATER = '2026-09-08T07:00:00.000Z'

const watchSignal = (over = {}) => ({
  kind: 'watch',
  evidenceId: 'watch:2026-09-07T22:00:00.000Z',
  confirmed: false,
  resetType: null,
  observedAt: '2026-09-07T22:00:00.000Z',
  expiresAt: '2026-09-08T06:00:00.000Z',
  scheduledFor: null,
  sourceUrl: 'https://x.com/thsottiaux/status/2096900000000000000',
  windowStartUtc: '2026-09-08T01:00:00.000Z',
  windowEndUtc: '2026-09-08T02:00:00.000Z',
  windowBasis: 'around',
  windowInputs: {},
  ...over
})

const priorWith = signal => ({
  version: 1,
  lastReset: {
    id: 'r1',
    resetType: 'regular',
    announcedAt: '2026-09-05T00:39:25.000Z'
  },
  signal,
  projection: signal
    ? {
        uid: 'codex-reset-watch@janejeon.com',
        href: '/cal/codex-reset-watch.ics',
        etag: '"e1"',
        summary: signal.confirmed ? TITLE_CONFIRMED : TITLE_UNCONFIRMED,
        startUtc: signal.windowStartUtc,
        endUtc: signal.windowEndUtc,
        description: signal.sourceUrl
      }
    : null,
  health: {
    ok: true,
    reason: null,
    detail: null,
    evidenceHash: null,
    since: null
  },
  lastTransition: null
})

const reset = (id, over = {}) => ({
  id,
  resetType: 'regular',
  announcedAt: '2026-09-08T01:30:00.000Z',
  sourceType: 'observed',
  sourceUrl: `https://x.com/thsottiaux/status/${id}`,
  ...over
})

test('a 304 changes nothing at all', () => {
  const prior = priorWith(watchSignal())
  const r = decide(prior, { notModified: true }, { now: NOW })
  assert.equal(r.calendar.action, 'none')
  assert.equal(r.telegram, null)
  assert.equal(r.health.ok, true)
  assert.deepEqual(r.nextState.signal, prior.signal)
})

test('a first credible signal creates the event and says so once', () => {
  const next = {
    latestReset: reset('r1'),
    signal: watchSignal(),
    failure: null
  }
  const r = decide(priorWith(null), next, { now: NOW })
  assert.equal(r.calendar.action, 'create')
  assert.equal(r.calendar.desired.summary, TITLE_UNCONFIRMED)
  assert.equal(r.telegram.type, 'upcoming')
})

test('a forecast becoming an announcement retitles and says so', () => {
  const prior = priorWith(watchSignal())
  const next = {
    latestReset: reset('r1'),
    signal: watchSignal({ kind: 'scheduled', confirmed: true }),
    failure: null
  }
  const r = decide(prior, next, { now: NOW })
  assert.equal(r.calendar.action, 'update')
  assert.equal(r.calendar.desired.summary, TITLE_CONFIRMED)
  assert.equal(r.telegram.type, 'confirmed')
})

test('an unchanged signal issues no calendar request whatsoever', () => {
  const prior = priorWith(watchSignal())
  const next = {
    latestReset: reset('r1'),
    signal: watchSignal(),
    failure: null
  }
  const r = decide(prior, next, { now: NOW })
  assert.equal(r.calendar.action, 'none')
  assert.equal(r.telegram, null)
})

test('a material window move updates and interrupts; a small one only updates', () => {
  const prior = priorWith(watchSignal())

  const big = decide(
    prior,
    {
      latestReset: reset('r1'),
      signal: watchSignal({
        windowStartUtc: '2026-09-08T02:00:00.000Z',
        windowEndUtc: '2026-09-08T03:00:00.000Z'
      }),
      failure: null
    },
    { now: NOW }
  )
  assert.equal(big.calendar.action, 'update')
  assert.equal(big.telegram.type, 'moved')

  const small = decide(
    prior,
    {
      latestReset: reset('r1'),
      signal: watchSignal({
        windowStartUtc: '2026-09-08T01:05:00.000Z',
        windowEndUtc: '2026-09-08T02:05:00.000Z'
      }),
      failure: null
    },
    { now: NOW }
  )
  assert.equal(small.calendar.action, 'update', 'the projection must stay true')
  assert.equal(small.telegram, null, 'five minutes is not news')
  assert.ok(5 * 60 * 1000 < MATERIAL_SHIFT_MS)
})

test('a source-only change rewrites the description without interrupting', () => {
  const prior = priorWith(watchSignal())
  const next = {
    latestReset: reset('r1'),
    signal: watchSignal({ sourceUrl: 'https://x.com/thsottiaux/status/2097' }),
    failure: null
  }
  const r = decide(prior, next, { now: NOW })
  assert.equal(r.calendar.action, 'update')
  assert.equal(
    r.calendar.desired.description,
    'https://x.com/thsottiaux/status/2097'
  )
  assert.equal(r.telegram, null)
})

test('a new regular reset id means completion: the event goes, and one message', () => {
  const prior = priorWith(watchSignal())
  const next = { latestReset: reset('r2'), signal: null, failure: null }
  const r = decide(prior, next, { now: NOW })
  assert.equal(r.calendar.action, 'delete')
  assert.equal(r.telegram.type, 'completed')
  assert.equal(r.nextState.signal, null)
  assert.equal(r.nextState.projection, null)
  assert.equal(r.health.ok, true)
})

test('a banked reset landing is recorded but is not a completion', () => {
  const prior = priorWith(watchSignal())
  const next = {
    latestReset: reset('r2', { resetType: 'banked' }),
    signal: watchSignal(),
    failure: null
  }
  const r = decide(prior, next, { now: NOW })
  assert.equal(r.calendar.action, 'none')
  assert.equal(r.telegram, null)
  assert.equal(r.nextState.lastReset.id, 'r2')
  assert.deepEqual(r.nextState.signal, prior.signal, 'the signal must survive')
})

test('a reset announced before the signal existed is not that signal completing', () => {
  const prior = priorWith(watchSignal())
  const next = {
    latestReset: reset('r2', { announcedAt: '2026-09-06T00:00:00.000Z' }),
    signal: watchSignal(),
    failure: null
  }
  const r = decide(prior, next, { now: NOW })
  assert.notEqual(r.calendar.action, 'delete')
})

// The two rows below are the same disappearance seen at two different times.
// This is the distinction the whole state model exists to make.
test('a forecast vanishing after its stated expiry is a safe withdrawal', () => {
  const prior = priorWith(watchSignal())
  const next = { latestReset: reset('r1'), signal: null, failure: null }
  const r = decide(prior, next, { now: LATER })
  assert.equal(r.calendar.action, 'delete')
  assert.equal(r.telegram.type, 'withdrawn')
  assert.equal(r.health.ok, true)
})

test('a forecast vanishing before its expiry is unclassifiable, so nothing is touched', () => {
  const prior = priorWith(watchSignal())
  const next = { latestReset: reset('r1'), signal: null, failure: null }
  const r = decide(prior, next, { now: NOW })
  assert.equal(
    r.calendar.action,
    'none',
    'never delete an event we cannot reason about'
  )
  assert.equal(r.telegram, null)
  assert.equal(r.health.ok, false)
  assert.equal(r.health.reason, 'unclassifiable_disappearance')
})

test('an announced reset vanishing is always unclassifiable, since it has no expiry', () => {
  const prior = priorWith(
    watchSignal({ kind: 'scheduled', confirmed: true, expiresAt: null })
  )
  const next = { latestReset: reset('r1'), signal: null, failure: null }
  const r = decide(prior, next, { now: LATER })
  assert.equal(r.calendar.action, 'none')
  assert.equal(r.health.ok, false)
  assert.equal(r.health.reason, 'unclassifiable_disappearance')
  assert.match(r.health.detail, /carries no expiry/)
})

test('an unparseable window touches nothing and stays silent on Telegram', () => {
  const prior = priorWith(watchSignal())
  const next = {
    latestReset: reset('r1'),
    signal: null,
    failure: {
      reason: 'unparseable_window',
      detail: 'time-shaped text that no allowlist pattern matched',
      evidence: { forecastWindow: 'Lands end of day' }
    }
  }
  const r = decide(prior, next, { now: NOW })
  assert.equal(r.calendar.action, 'none')
  assert.equal(
    r.telegram,
    null,
    'our own parser gap is Kuma business, not hers'
  )
  assert.equal(r.health.ok, false)
  assert.deepEqual(
    r.nextState.signal,
    prior.signal,
    'the signal must not advance'
  )
})

test('a contradiction messages once and then stays quiet while it persists', () => {
  const prior = priorWith(watchSignal())
  const failure = {
    reason: 'contradictory_window',
    detail: 'upper bound at or before the anchor',
    evidence: { forecastWindow: 'around 7pm, by 6pm' }
  }
  const next = { latestReset: reset('r1'), signal: null, failure }

  const first = decide(prior, next, { now: NOW })
  assert.equal(first.telegram.type, 'contradiction')

  const second = decide(first.nextState, next, { now: LATER })
  assert.equal(second.telegram, null, 'the same contradiction must not repeat')
  assert.equal(second.health.ok, false)
  assert.equal(
    second.health.since,
    first.health.since,
    'down-since must not reset'
  )
})
