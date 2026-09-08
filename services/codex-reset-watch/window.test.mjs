import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveWindow, zonedToUtc, partsIn } from './window.mjs'

const PT = 'America/Los_Angeles'

// Every announcement the parser sees carries its own timestamp, so windows are
// derived relative to that rather than to the wall clock of the test run.
const SEP_7 = '2026-09-07T22:00:00.000Z' // 15:00 PDT
const iso = ms => new Date(ms).toISOString()

test('zonedToUtc: resolves standard and daylight offsets', () => {
  assert.equal(
    iso(zonedToUtc(2026, 1, 15, 18, 0, PT)),
    '2026-01-16T02:00:00.000Z'
  )
  assert.equal(
    iso(zonedToUtc(2026, 7, 15, 18, 0, PT)),
    '2026-07-16T01:00:00.000Z'
  )
})

test('zonedToUtc: refuses a wall time the spring-forward gap deletes', () => {
  assert.equal(zonedToUtc(2026, 3, 8, 2, 30, PT), null)
})

test('zonedToUtc: picks the earlier occurrence on the autumn fall-back', () => {
  // 01:30 happens twice on 2026-11-01. The earlier one is still PDT (UTC-7).
  assert.equal(
    iso(zonedToUtc(2026, 11, 1, 1, 30, PT)),
    '2026-11-01T08:30:00.000Z'
  )
})

test('partsIn: reads wall-clock fields back in the target zone', () => {
  const p = partsIn(Date.parse('2026-09-08T01:00:00.000Z'), PT)
  assert.equal(p.hour, 18)
  assert.equal(p.day, 7)
})

test('around 6pm plus by 7pm becomes 18:00-19:00', () => {
  const r = deriveWindow({
    text: 'Reset lands around 6pm PT, by 7pm PT.',
    evidenceAt: SEP_7
  })
  assert.equal(r.ok, true)
  assert.equal(iso(r.startMs), '2026-09-08T01:00:00.000Z')
  assert.equal(iso(r.endMs), '2026-09-08T02:00:00.000Z')
  assert.equal(r.basis, 'around+by')
})

test('the historical bug: around 6pm PST with by 02:00 UTC is never recentered', () => {
  // The deleted Scheduled task turned this exact pair into 18:30-19:30 by
  // averaging. 02:00 UTC is 19:00 PDT, so the window is 18:00-19:00.
  for (const text of [
    'Reset lands around 6pm PST and should land by 2am UTC.',
    'Reset lands around 6pm PST and should land by 2026-09-08T02:00:00Z.'
  ]) {
    const r = deriveWindow({ text, evidenceAt: SEP_7 })
    assert.equal(r.ok, true, text)
    assert.equal(iso(r.startMs), '2026-09-08T01:00:00.000Z', text)
    assert.equal(iso(r.endMs), '2026-09-08T02:00:00.000Z', text)
    assert.notEqual(iso(r.startMs), '2026-09-08T01:30:00.000Z', text)
  }
})

test('casual Pacific abbreviations follow the date, not the label', () => {
  // "PST" in July still means Pacific local time, which is daylight time then.
  const summer = deriveWindow({
    text: 'Reset lands around 6pm PST.',
    evidenceAt: '2026-07-15T20:00:00.000Z'
  })
  assert.equal(iso(summer.startMs), '2026-07-16T01:00:00.000Z')

  const winter = deriveWindow({
    text: 'Reset lands around 6pm PDT.',
    evidenceAt: '2026-01-15T20:00:00.000Z'
  })
  assert.equal(iso(winter.startMs), '2026-01-16T02:00:00.000Z')
})

test('a wall-clock time inside the spring-forward gap is a contradiction', () => {
  const r = deriveWindow({
    text: 'Reset lands around 2:30am PT.',
    evidenceAt: '2026-03-08T08:00:00.000Z'
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'contradiction')
})

// The five expressions below all appear in the tracker's real history. Each
// one would become a wrong calendar entry under an unanchored parser, so each
// gets a regression test asserting no window comes out of it.
const CORPUS_FALSE_POSITIVES = [
  [
    'a percentage',
    'After the fix, usage dropped around 10% for users making heavy use of images.'
  ],
  [
    'an outage window',
    'Last night around 2am to 4am we suffered an almost global outage.'
  ],
  [
    'how long a fix took',
    'This was fixed in ~8 mins and we are now back online and fully operational.'
  ],
  [
    'an eligibility deadline',
    'PS: If you create the account or upgrade before 8pm PT you will get it too.'
  ],
  [
    'a bank credit period',
    'We will credit one additional reset into your bank for your own usage over the next 24 hours.'
  ]
]

for (const [what, text] of CORPUS_FALSE_POSITIVES) {
  test(`corpus false positive is never a window: ${what}`, () => {
    const r = deriveWindow({ text, evidenceAt: SEP_7 })
    assert.equal(r.ok, false, `"${text}" must not yield a window`)
  })
}

// These are the forms the corpus actually uses most often.
test('"in the next N" is an upper bound running from the announcement', () => {
  const cases = [
    ['Lands in the next hour.', 60],
    ['Propagating in the next hour.', 60],
    ['Should land over next 30 minutes.', 30],
    ['This should propagate to all users over the next 10 mins, enjoy!', 10]
  ]
  for (const [text, minutes] of cases) {
    const r = deriveWindow({ text, evidenceAt: SEP_7 })
    assert.equal(r.ok, true, `"${text}" should parse`)
    assert.equal(r.basis, 'by', text)
    assert.equal(iso(r.startMs), SEP_7, text)
    assert.equal(
      r.endMs - Date.parse(SEP_7),
      minutes * 60 * 1000,
      `"${text}" should end ${minutes} minutes out`
    )
  }
})

test('"in ~ N hours" is an approximation, so it anchors rather than bounds', () => {
  // "First one will land in ~ 3 hours" says roughly three hours out, not
  // within three hours. It is an anchor, and an anchor runs one hour.
  const r = deriveWindow({
    text: 'First one will land in ~ 3 hours.',
    evidenceAt: SEP_7
  })
  assert.equal(r.ok, true)
  assert.equal(r.basis, 'around')
  assert.equal(r.startMs - Date.parse(SEP_7), 3 * 60 * 60 * 1000)
  assert.equal(r.endMs - r.startMs, 60 * 60 * 1000)
})

test('a landing verb whose subject is not the reset yields no window', () => {
  // Other things land too. This case is absent from the 52 real announcements
  // and was found by checking a dependency parser against this one: without the
  // competing-subject guard, the second clause clears the landing-verb check and
  // produces a confident, wrong window.
  const r = deriveWindow({
    text: 'The outage started around 2am and the fix landed at 4am.',
    evidenceAt: SEP_7
  })
  assert.equal(r.ok, false)
})

test('a competing subject does not block a clause that also names the reset', () => {
  const r = deriveWindow({
    text: 'Limits land around 6pm PT during scheduled maintenance.',
    evidenceAt: SEP_7
  })
  assert.equal(r.ok, true)
  assert.equal(iso(r.startMs), '2026-09-08T01:00:00.000Z')
})

test('one clause landing and another crediting do not merge into one window', () => {
  // The real announcement puts a true "in the next hour" and a false "over the
  // next 24 hours" in one sentence, joined by "and".
  const r = deriveWindow({
    text:
      'Codex usage limits will be fully reset again in the next hour and we will credit ' +
      'one additional reset into your bank for your own usage over the next 24 hours.',
    evidenceAt: SEP_7
  })
  assert.equal(r.ok, true)
  assert.equal(r.endMs - Date.parse(SEP_7), 60 * 60 * 1000)
})

test('a vague landing phrase fails loudly rather than silently', () => {
  const r = deriveWindow({ text: 'Lands end of day.', evidenceAt: SEP_7 })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'unparseable')
  assert.match(r.detail, /time-shaped/)
})

test('scheduled_for is used as an upper bound without any text parsing', () => {
  const r = deriveWindow({
    scheduledFor: '2026-09-08T02:00:00.000Z',
    text: 'A reset is coming.',
    evidenceAt: SEP_7
  })
  assert.equal(r.ok, true)
  assert.equal(r.basis, 'by')
  assert.equal(iso(r.endMs), '2026-09-08T02:00:00.000Z')
  assert.equal(iso(r.startMs), SEP_7)
})

test('an upper bound before the announcement is a contradiction', () => {
  const r = deriveWindow({
    scheduledFor: '2026-09-07T20:00:00.000Z',
    evidenceAt: SEP_7
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'contradiction')
})

test('an upper bound at or before the anchor is a contradiction', () => {
  const r = deriveWindow({
    text: 'Reset lands around 7pm PT, by 6pm PT.',
    evidenceAt: SEP_7
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'contradiction')
})

test('an ISO interval is taken verbatim', () => {
  const r = deriveWindow({
    forecastWindow: 'Lands 2026-09-08T01:00:00Z/2026-09-08T02:00:00Z',
    evidenceAt: SEP_7
  })
  assert.equal(r.ok, true)
  assert.equal(r.basis, 'range')
  assert.equal(iso(r.startMs), '2026-09-08T01:00:00.000Z')
  assert.equal(iso(r.endMs), '2026-09-08T02:00:00.000Z')
})

test('around alone runs one hour', () => {
  const r = deriveWindow({
    text: 'Reset lands around 6pm PT.',
    evidenceAt: SEP_7
  })
  assert.equal(r.ok, true)
  assert.equal(r.basis, 'around')
  assert.equal(r.endMs - r.startMs, 60 * 60 * 1000)
})

test('text with no temporal content at all is unparseable, not empty', () => {
  const r = deriveWindow({ text: 'A reset is on the way.', evidenceAt: SEP_7 })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'unparseable')
  assert.match(r.detail, /no temporal claim/)
})

test('every parse attempt is logged with its raw input', () => {
  const lines = []
  const logger = {
    info: (o, m) => lines.push({ ...o, m }),
    warn: (o, m) => lines.push({ ...o, m })
  }
  deriveWindow(
    { forecastWindow: 'Lands end of day', evidenceAt: SEP_7 },
    { logger }
  )
  const warned = lines.find(l => l.m === 'window unparseable')
  assert.ok(warned, 'an unparseable window must be logged')
  assert.equal(warned.forecastWindow, 'Lands end of day')
})
