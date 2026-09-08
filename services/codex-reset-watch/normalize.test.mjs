import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalize, KNOWN_TITLES, LEGACY_TITLES } from './normalize.mjs'

const load = name =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')
  ).data

test('an idle payload yields the last reset and no signal', () => {
  const r = normalize(load('status-idle'))
  assert.equal(r.signal, null)
  assert.equal(r.failure, null)
  assert.equal(r.latestReset.id, 'observed-2097043464538264003')
  assert.equal(r.latestReset.resetType, 'regular')
  assert.equal(
    r.latestReset.sourceUrl,
    'https://x.com/thsottiaux/status/2097043464538264003'
  )
})

test('a watch is a credible but unconfirmed signal', () => {
  const r = normalize(load('status-watch'))
  assert.equal(r.signal.kind, 'watch')
  assert.equal(r.signal.confirmed, false)
  assert.equal(r.signal.expiresAt, '2026-09-08T06:00:00.000Z')
  assert.equal(r.signal.windowStartUtc, '2026-09-08T01:00:00.000Z')
  assert.equal(r.signal.windowEndUtc, '2026-09-08T02:00:00.000Z')
})

test('an announced reset is confirmed, and scheduled_for bounds it', () => {
  // Confirmed means a person announced it, not that it has happened. The
  // source type is checked rather than the status field, because the tracker
  // spec warns that a passed scheduled_for does not imply completion.
  const r = normalize(load('status-scheduled'))
  assert.equal(r.signal.kind, 'scheduled')
  assert.equal(r.signal.confirmed, true)
  assert.equal(r.signal.windowBasis, 'by')
  assert.equal(r.signal.windowEndUtc, '2026-09-08T02:00:00.000Z')
})

test('a scheduled reset with a non-human source is not confirmed', () => {
  const data = load('status-scheduled')
  data.scheduled_reset.source = { type: 'observed' }
  const r = normalize(data)
  assert.equal(r.signal.confirmed, false)
})

test('a banked scheduled reset is ignored entirely', () => {
  const r = normalize(load('status-scheduled-banked'))
  assert.equal(r.signal, null)
  assert.equal(r.failure, null, 'ignoring banked must not look like a failure')
})

test('a watch that reads as banked is ignored, since Watch has no reset_type', () => {
  const data = load('status-watch')
  data.active_watch.text =
    'We will grant a banked reset, landing around 6pm PT.'
  const r = normalize(data)
  assert.equal(r.signal, null)
  assert.equal(r.failure, null)
})

test('an announcement outranks a forecast when both are present', () => {
  const data = load('status-scheduled')
  data.active_watch = load('status-watch').active_watch
  const r = normalize(data)
  assert.equal(r.signal.kind, 'scheduled')
})

test('an underivable window is a failure, never a silently absent signal', () => {
  const data = load('status-watch')
  data.active_watch.forecast_window = 'Lands end of day'
  data.active_watch.text = 'Lands end of day.'
  const r = normalize(data)
  assert.equal(r.signal, null)
  assert.equal(r.failure.reason, 'unparseable_window')
  assert.equal(
    r.failure.evidence.forecastWindow,
    'Lands end of day',
    'the raw string must be carried so the allowlist can be extended from it'
  )
})

test('contradictory evidence is reported as a contradiction, not as unparseable', () => {
  const data = load('status-watch')
  data.active_watch.forecast_window = 'Reset lands around 7pm PT, by 6pm PT'
  data.active_watch.text = 'Reset lands around 7pm PT, by 6pm PT.'
  const r = normalize(data)
  assert.equal(r.failure.reason, 'contradictory_window')
})

test('a source with no url still normalizes, since url is optional', () => {
  // The observed source variant only requires `type`.
  const data = load('status-watch')
  data.active_watch.source = { type: 'observed' }
  const r = normalize(data)
  assert.equal(r.signal.sourceUrl, null)
})

test('the legacy title list is empty by evidence, not by omission', () => {
  // A five-month sweep of the Events calendar found no other Codex title.
  // Membership in this list licenses deletion, so it stays empty until a real
  // stray title is observed.
  assert.deepEqual(LEGACY_TITLES, [])
  assert.equal(KNOWN_TITLES.length, 2)
})
