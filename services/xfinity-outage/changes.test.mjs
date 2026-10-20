import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMessage, detectChanges, extractState } from './changes.mjs'

// Fixtures mirror the fields monitor.mjs reads from the Xfinity API. The
// values are the 2026-10-19 outage: started 9:06 PM PDT, estimate 12:10 AM.
const START = '2026-10-19T21:06:00-07:00'
const ETR = '2026-10-20T00:10:00-07:00'
const ETR_DISPLAY = '10/20/2026 12:10 AM (Pacific)'

function listed({
  etr = null,
  etrDisplay = null,
  outageType = 'Unplanned',
  planned = false,
  start = START,
  id = 'OUTAGE-1'
} = {}) {
  return {
    outageInfoResponseList: [
      {
        outageId: id,
        services: ['TV', 'cDVR', 'Internet', 'Voice', 'Channels'],
        startTime: { iso: start }
      }
    ],
    customerMessage: {
      outageType,
      planned,
      etr: etr ? { iso: etr } : null,
      etrOutputString: etrDisplay
    }
  }
}

// The shape the API returned at 23:01 PDT on 2026-10-19, once the outage
// was gone: an empty list and a summary message with every field null.
const CLEARED = {
  outageInfoResponseList: [],
  customerMessage: {
    messageType: 'Summary',
    etrIsASAP: null,
    earliestImpactStart: null,
    etrOutputString: null,
    etr: null,
    techStatus: null
  }
}

const at = iso => new Date(iso)
const state = (payload, iso) => extractState(payload, at(iso))
const message = (old, next) => buildMessage(detectChanges(old, next), next)

test('a dropped estimate is not "moved up", and sends nothing', () => {
  // 22:30 and 22:45 PDT runs on 2026-10-19. The 22:45 run once sent
  // "ETA moved up: 12:10 AM → null. Internet still down", although the
  // house had been back online for about 15 minutes.
  const before = state(
    listed({ etr: ETR, etrDisplay: ETR_DISPLAY }),
    '2026-10-20T05:30:20Z'
  )
  const after = state(listed(), '2026-10-20T05:45:20Z')

  assert.deepEqual(detectChanges(before, after), [
    { type: 'etr_cleared', oldEtr: ETR_DISPLAY }
  ])
  assert.equal(message(before, after), '')
})

test('an estimate appearing is "posted", not "pushed back"', () => {
  const before = state(listed(), '2026-10-20T04:15:20Z')
  const after = state(
    listed({ etr: ETR, etrDisplay: ETR_DISPLAY }),
    '2026-10-20T04:30:20Z'
  )

  assert.deepEqual(detectChanges(before, after), [
    { type: 'etr_set', newEtr: ETR_DISPLAY }
  ])
  const text = message(before, after)
  assert.match(text, /Outage ETA posted/)
  assert.match(text, /estimates restoration by 10\/20\/2026 12:10 AM/)
})

test('a later estimate is pushed back, an earlier one moved up', () => {
  const base = state(
    listed({ etr: ETR, etrDisplay: ETR_DISPLAY }),
    '2026-10-20T04:30:20Z'
  )
  const later = state(
    listed({
      etr: '2026-10-20T02:00:00-07:00',
      etrDisplay: '10/20/2026 2:00 AM (Pacific)'
    }),
    '2026-10-20T04:45:20Z'
  )
  const earlier = state(
    listed({
      etr: '2026-10-19T23:30:00-07:00',
      etrDisplay: '10/19/2026 11:30 PM (Pacific)'
    }),
    '2026-10-20T04:45:20Z'
  )

  assert.equal(detectChanges(base, later)[0].type, 'etr_pushed')
  assert.match(
    message(base, later),
    /12:10 AM \(Pacific\) → 10\/20\/2026 2:00 AM/
  )
  assert.equal(detectChanges(base, earlier)[0].type, 'etr_earlier')
})

test('the same instant written with a different offset is no change', () => {
  const pacific = state(
    listed({ etr: ETR, etrDisplay: ETR_DISPLAY }),
    '2026-10-20T04:30:20Z'
  )
  const utc = state(
    listed({ etr: '2026-10-20T07:10:00Z', etrDisplay: ETR_DISPLAY }),
    '2026-10-20T04:45:20Z'
  )
  assert.deepEqual(detectChanges(pacific, utc), [])
})

test('a new outage without an estimate says so in words', () => {
  const quiet = state(CLEARED, '2026-10-20T04:00:20Z')
  const down = state(listed(), '2026-10-20T04:15:20Z')
  const text = message(quiet, down)
  assert.match(text, /Xfinity: Internet is down/)
  assert.match(text, /has not given a restore time yet/)
})

test('planned maintenance without an end time says so in words', () => {
  const quiet = state(CLEARED, '2026-10-20T04:00:20Z')
  const upcoming = state(
    listed({ planned: true, start: '2026-10-22T00:00:00-07:00' }),
    '2026-10-20T04:15:20Z'
  )
  const ongoing = state(listed({ planned: true }), '2026-10-20T04:15:20Z')
  assert.match(message(quiet, upcoming), /Xfinity has not given an end time/)
  assert.match(message(quiet, ongoing), /has not given a restore time/)
})

test('a reclassified outage without an estimate omits the ETA', () => {
  const before = state(listed(), '2026-10-20T04:15:20Z')
  const after = state(listed({ outageType: 'Network' }), '2026-10-20T04:30:20Z')
  const text = message(before, after)
  assert.match(text, /now listed as Network/)
  assert.doesNotMatch(text, /ETA/)
})

// Covers missing and unreadable estimates and outage types, and every
// transition between these states. A missing start time is not covered: the
// messages other than "back" still say "unknown time" for it.
test('a missing value never shows as null, undefined, NaN or Invalid Date', () => {
  const t = '2026-10-20T04:15:20Z'
  const states = [
    state(CLEARED, t),
    state(listed(), t),
    state(listed({ etr: ETR, etrDisplay: ETR_DISPLAY }), t),
    state(listed({ etr: ETR }), t),
    state(listed({ etr: '2026-10-20T02:00:00-07:00' }), t),
    state(listed({ outageType: 'Network' }), t),
    state(listed({ planned: true }), t),
    state(listed({ planned: true, etr: ETR }), t),
    state(listed({ planned: true, start: '2026-10-22T00:00:00-07:00' }), t),
    state(listed({ id: 'OUTAGE-2' }), t),
    state(listed({ outageType: null }), t),
    state(listed({ outageType: null, etr: ETR }), t),
    state(listed({ etr: 'TBD' }), t),
    state(listed({ etr: 'ASAP', outageType: 'Network' }), t)
  ]
  for (const a of [null, ...states])
    for (const b of states) {
      const text = buildMessage(detectChanges(a, b), b)
      assert.doesNotMatch(
        text,
        /null|undefined|NaN|Invalid Date|unknown time/,
        text
      )
    }
})

test('2026-10-19 end to end: one alert down, none at 22:45, one alert back', () => {
  // The four runs that mattered, in order. Before this fix the sequence sent
  // "Internet is down", then "ETA moved up → null", then "back after ~1h 55m".
  const runs = [
    state(CLEARED, '2026-10-20T04:00:20Z'),
    state(
      listed({ etr: ETR, etrDisplay: ETR_DISPLAY }),
      '2026-10-20T04:15:20Z'
    ),
    state(
      listed({ etr: ETR, etrDisplay: ETR_DISPLAY }),
      '2026-10-20T05:30:20Z'
    ),
    state(listed(), '2026-10-20T05:45:20Z'),
    state(CLEARED, '2026-10-20T06:00:20Z')
  ]
  const sent = runs
    .slice(1)
    .map((next, i) => message(runs[i], next))
    .filter(Boolean)

  assert.equal(sent.length, 2)
  assert.match(sent[0], /Xfinity: Internet is down/)
  assert.match(sent[0], /9:06 PM PDT/)
  assert.equal(
    sent[1],
    '<b>Xfinity: Internet is back</b>\n\n' +
      'Xfinity has cleared the outage that started at 9:06 PM PDT.' +
      ' It was still listed at 10:45 PM PDT and gone by 11:00 PM PDT.'
  )
})

test('planned maintenance removed before it starts reports no downtime', () => {
  // The old message measured "downtime" from a future start, printing ~-4004m.
  const scheduled = state(
    listed({ planned: true, start: '2026-10-22T00:00:00-07:00' }),
    '2026-10-20T04:15:20Z'
  )
  const gone = state(CLEARED, '2026-10-20T04:30:20Z')
  const text = message(scheduled, gone)
  assert.match(text, /Planned maintenance removed/)
  assert.match(text, /scheduled for 12:00 AM PDT/)
  assert.doesNotMatch(text, /Internet is back|downtime|-\d/)
})

test('planned maintenance that ran and finished reads as back', () => {
  const running = state(listed({ planned: true }), '2026-10-20T04:15:20Z')
  const gone = state(CLEARED, '2026-10-20T04:30:20Z')
  assert.match(message(running, gone), /Xfinity: Internet is back/)
})

test('an outage type that disappears while listed sends nothing', () => {
  // The variant of 2026-10-19 the review found: the outage stays listed but
  // the message loses its type. It once read "now listed as null. Internet
  // still down".
  const before = state(
    listed({ etr: ETR, etrDisplay: ETR_DISPLAY }),
    '2026-10-20T05:30:20Z'
  )
  const after = state(listed({ outageType: null }), '2026-10-20T05:45:20Z')
  assert.deepEqual(
    detectChanges(before, after).map(c => c.type),
    ['etr_cleared', 'type_cleared']
  )
  assert.equal(message(before, after), '')
})

test('an outage type that appears is reported without "null"', () => {
  const before = state(listed({ outageType: null }), '2026-10-20T04:15:20Z')
  const after = state(listed({ outageType: 'Network' }), '2026-10-20T04:30:20Z')
  assert.match(message(before, after), /Xfinity now lists it as Network\./)
})

test('an unreadable estimate counts as no estimate', () => {
  const quiet = state(CLEARED, '2026-10-20T04:00:20Z')
  const tbd = state(listed({ etr: 'TBD' }), '2026-10-20T04:15:20Z')
  const asap = state(listed({ etr: 'ASAP' }), '2026-10-20T04:30:20Z')
  const timed = state(
    listed({ etr: ETR, etrDisplay: ETR_DISPLAY }),
    '2026-10-20T04:45:20Z'
  )
  assert.match(message(quiet, tbd), /has not given a restore time yet/)
  assert.deepEqual(detectChanges(tbd, asap), [])
  assert.equal(detectChanges(asap, timed)[0].type, 'etr_set')
  assert.equal(detectChanges(timed, tbd)[0].type, 'etr_cleared')
})

test('a cleared outage with no start time leaves the start out', () => {
  const before = state(listed({ start: null }), '2026-10-20T05:45:20Z')
  const gone = state(CLEARED, '2026-10-20T06:00:20Z')
  assert.equal(
    message(before, gone),
    '<b>Xfinity: Internet is back</b>\n\n' +
      'Xfinity has cleared the outage.' +
      ' It was still listed at 10:45 PM PDT and gone by 11:00 PM PDT.'
  )
})
