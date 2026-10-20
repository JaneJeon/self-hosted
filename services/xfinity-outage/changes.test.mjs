import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMessage,
  buildSlack,
  carryOver,
  detectChanges,
  extractState
} from './changes.mjs'

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
  assert.match(text, /scheduled for 10\/22\/2026, 12:00 AM PDT\./)
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

test('an estimate without a display string keeps its date', () => {
  // Without the date, a whole-day move read "12:10 AM PDT → 12:10 AM PDT".
  const today = state(listed({ etr: ETR }), '2026-10-20T04:30:20Z')
  const tomorrow = state(
    listed({ etr: '2026-10-21T00:10:00-07:00' }),
    '2026-10-20T04:45:20Z'
  )
  assert.match(
    message(today, tomorrow),
    /10\/20\/2026, 12:10 AM PDT → 10\/21\/2026, 12:10 AM PDT\./
  )
})

// 2026-10-20, from the Railway logs. The outage record at 12:17 PDT and the
// "Technician in your area" notice that replaced it at 12:31 PDT; the street
// is a stand-in.
const OUTAGE_1020 = {
  outageInfoResponseList: [
    {
      outageId: 'OUT14101723',
      services: ['Internet'],
      startTime: { iso: '2026-10-20T07:32:17-07:00' }
    }
  ],
  customerMessage: {
    messageType: 'Summary',
    impactStyle: 'High Impact',
    outageType: 'Outage',
    planned: false,
    customerFacingText: 'Network Damage',
    etr: { iso: '2026-10-20T18:55:00-07:00' },
    etrOutputString: '10/20/2026 06:55 PM (Pacific)',
    messages: {
      shortDescription: 'Internet outage detected',
      detailedDescription:
        'Your Xfinity services at 100 MAIN ST may be unavailable due to an issue with our network.'
    }
  }
}
const NOTICE_TEXT =
  "To make sure your XFINITY services are performing optimally, we'll be doing some work in your area today. While we're working, you could experience brief interruptions to your service. We apologize for any inconvenience caused by our work."
const notice = (extra = {}) => ({
  outageInfoResponseList: [
    {
      outageId: 'OUT14101723',
      services: ['Internet'],
      startTime: { iso: '2026-10-20T10:32:00-07:00' }
    }
  ],
  customerMessage: {
    messageType: 'Summary',
    impactStyle: 'Low Impact',
    outageType: 'Informational',
    planned: false,
    etr: null,
    etrOutputString: null,
    messages: {
      shortDescription: 'Technician in your area',
      detailedDescription: NOTICE_TEXT
    },
    ...extra
  }
})

// Runs payloads through the monitor's state steps and returns, per run, the
// Telegram text and the Slack text.
function replay(runs, start = null) {
  let old = start
  return runs.map(([payload, t]) => {
    const next = carryOver(old, state(payload, t))
    const changes = detectChanges(old, next)
    const out = {
      telegram: buildMessage(changes, next),
      slack: buildSlack(old, next),
      types: changes.map(c => c.type)
    }
    old = next
    return out
  })
}

const MOVED_1020 = {
  ...OUTAGE_1020,
  outageInfoResponseList: [
    {
      ...OUTAGE_1020.outageInfoResponseList[0],
      startTime: { iso: '2026-10-20T10:32:00-07:00' }
    }
  ]
}

test('2026-10-20 end to end: down, the notice in Xfinity words, back when nothing is listed', () => {
  // The 12:31 run once sent "Outage reclassified: now listed as
  // Informational. Internet still down since 10:32 AM PDT", and the 12:46 run
  // "Internet is back … started at 10:32 AM PDT". Home Assistant's heartbeat
  // was back at 12:17, but the notice itself warned of interruptions.
  const [quiet, down, moved, tech, gone] = replay([
    [CLEARED, '2026-10-20T14:30:20Z'],
    [OUTAGE_1020, '2026-10-20T14:45:57Z'],
    [MOVED_1020, '2026-10-20T19:17:32Z'],
    [notice(), '2026-10-20T19:31:12Z'],
    [CLEARED, '2026-10-20T19:46:25Z']
  ])
  assert.equal(quiet.telegram, '')
  assert.match(down.telegram, /^<b>Xfinity: Internet is down<\/b>/)
  assert.match(down.telegram, /started at 7:32 AM PDT/)
  assert.equal(moved.telegram, '')
  assert.equal(
    tech.telegram,
    '<b>Xfinity: Technician in your area</b>\n\n' +
      'Xfinity no longer lists the outage that started at 7:32 AM PDT.' +
      ' It was still listed at 12:17 PM PDT, and by 12:31 PM PDT Xfinity' +
      ' showed this notice instead:\n' +
      NOTICE_TEXT
  )
  assert.equal(
    gone.telegram,
    '<b>Xfinity: Internet is back</b>\n\n' +
      'Xfinity has cleared the outage that started at 7:32 AM PDT and the' +
      ' "Technician in your area" notice after it. The notice was still' +
      ' listed at 12:31 PM PDT and gone by 12:46 PM PDT.'
  )
  // Slack: only the two ends, so the PagerDuty alerts in between read as
  // this outage.
  assert.deepEqual(
    [quiet, down, moved, tech, gone].map(r => r.slack.split('\n')[0]),
    [
      '',
      ':red_circle: *Xfinity: Internet is down*',
      '',
      '',
      ':large_green_circle: *Xfinity: Internet is back*'
    ]
  )
  assert.equal(gone.slack.split('\n')[1], gone.telegram.split('\n\n')[1])
})

test('a notice with no outage before it is a heads-up, and leaves quietly', () => {
  const [, tech, again, gone] = replay([
    [CLEARED, '2026-10-20T19:16:20Z'],
    [notice(), '2026-10-20T19:31:20Z'],
    [notice(), '2026-10-20T19:46:20Z'],
    [CLEARED, '2026-10-20T20:01:20Z']
  ])
  assert.equal(
    tech.telegram,
    '<b>Xfinity: Technician in your area</b>\n\n' +
      NOTICE_TEXT +
      '\nXfinity lists this as a notice, not an outage.'
  )
  assert.equal(again.telegram, '')
  assert.deepEqual(gone.types, ['notice_cleared'])
  assert.equal(gone.telegram, '')
  assert.deepEqual([tech.slack, gone.slack], ['', ''])
  assert.equal(
    replay([[notice(), '2026-10-20T19:31:20Z']])[0].telegram,
    tech.telegram
  )
})

test('a notice that turns back into an outage is "Internet is down" again', () => {
  const runs = replay([
    [CLEARED, '2026-10-20T19:01:20Z'],
    [OUTAGE_1020, '2026-10-20T19:16:20Z'],
    [notice(), '2026-10-20T19:31:20Z'],
    [OUTAGE_1020, '2026-10-20T19:46:20Z'],
    [CLEARED, '2026-10-20T20:01:20Z']
  ])
  assert.deepEqual(
    runs.map(r => r.types),
    [[], ['new_outage'], ['outage_to_notice'], ['new_outage'], ['resolved']]
  )
  assert.match(runs[3].telegram, /^<b>Xfinity: Internet is down<\/b>/)
  assert.match(
    runs[4].telegram,
    /^<b>Xfinity: Internet is back<\/b>\n\nXfinity has cleared the outage that started at 7:32 AM PDT\. It was still listed/
  )
  // The Slack pair spans the whole stretch, the flip included.
  assert.equal(runs.filter(r => r.slack).length, 2)
})

test('the outage carries through a change of notice, and state saved before it', () => {
  const other = notice()
  other.outageInfoResponseList = [
    { ...other.outageInfoResponseList[0], outageId: 'OUT99999999' }
  ]
  const runs = replay([
    [OUTAGE_1020, '2026-10-20T19:16:20Z'],
    [notice(), '2026-10-20T19:31:20Z'],
    [other, '2026-10-20T19:46:20Z'],
    [CLEARED, '2026-10-20T20:01:20Z']
  ])
  assert.match(runs[2].telegram, /^<b>Xfinity: Technician in your area<\/b>/)
  assert.match(
    runs[3].telegram,
    /cleared the outage that started at 7:32 AM PDT and the "Technician in your area" notice after it/
  )
  // A notice saved by code without followsOutage ends quietly.
  const legacy = state(notice(), '2026-10-20T19:31:20Z')
  assert.deepEqual(
    detectChanges(
      legacy,
      carryOver(legacy, state(CLEARED, '2026-10-20T19:46:20Z'))
    ),
    [{ type: 'notice_cleared' }]
  )
})

test('a notice keeps its text, an outage never stores the street', () => {
  assert.equal(state(notice(), '2026-10-20T19:31:20Z').noticeText, NOTICE_TEXT)
  const outage = state(OUTAGE_1020, '2026-10-20T19:17:32Z')
  assert.equal(outage.noticeText, null)
  const runs = []
  let old = null
  for (const [p, t] of [
    [OUTAGE_1020, '2026-10-20T19:16:20Z'],
    [notice(), '2026-10-20T19:31:20Z'],
    [CLEARED, '2026-10-20T19:46:20Z']
  ]) {
    old = carryOver(old, state(p, t))
    runs.push(JSON.stringify(old))
  }
  for (const saved of runs) assert.doesNotMatch(saved, /MAIN ST/)
})

test('notice text from Xfinity is escaped, and missing text still reads', () => {
  const odd = notice({
    messages: { shortDescription: 'Work <today>', detailedDescription: 'A & B' }
  })
  assert.equal(
    replay([[odd, '2026-10-20T19:31:20Z']])[0].telegram,
    '<b>Xfinity: Work &lt;today&gt;</b>\n\nA &amp; B\n' +
      'Xfinity lists this as a notice, not an outage.'
  )
  const bare = notice({ messages: null })
  const runs = replay([
    [CLEARED, '2026-10-20T19:16:20Z'],
    [bare, '2026-10-20T19:31:20Z']
  ])
  assert.equal(
    runs[1].telegram,
    '<b>Xfinity: Notice for your address</b>\n\n' +
      'Xfinity lists this as a notice, not an outage.'
  )
  const after = replay([
    [OUTAGE_1020, '2026-10-20T19:16:20Z'],
    [bare, '2026-10-20T19:31:20Z'],
    [CLEARED, '2026-10-20T19:46:20Z']
  ])
  assert.match(after[1].telegram, /^<b>Xfinity: Notice for your address<\/b>/)
  assert.match(after[1].telegram, /this notice instead, with no text\.$/)
  assert.match(
    after[2].telegram,
    /and the notice after it\. The notice was still listed/
  )
  const quoted = replay([
    [OUTAGE_1020, '2026-10-20T19:16:20Z'],
    [odd, '2026-10-20T19:31:20Z'],
    [CLEARED, '2026-10-20T19:46:20Z']
  ])
  assert.match(
    quoted[2].telegram,
    /and the "Work &lt;today&gt;" notice after it/
  )
  assert.match(quoted[2].slack, /and the "Work &lt;today&gt;" notice after it/)
})

test('no sequence of outages and notices prints a bad token', () => {
  const t0 = Date.parse('2026-10-20T19:01:20Z')
  const payloads = [
    CLEARED,
    OUTAGE_1020,
    MOVED_1020,
    notice(),
    notice({ messages: null }),
    notice({ messages: { shortDescription: 7, detailedDescription: {} } }),
    listed({ planned: true, start: '2026-10-22T00:00:00-07:00' }),
    listed({ planned: true }),
    listed({ start: null })
  ]
  for (const a of payloads)
    for (const b of payloads)
      for (const c of payloads) {
        const runs = replay(
          [a, b, c, CLEARED].map((p, i) => [
            p,
            new Date(t0 + i * 900_000).toISOString()
          ])
        )
        for (const r of runs)
          for (const text of [r.telegram, r.slack])
            assert.doesNotMatch(
              text,
              /null|undefined|NaN|Invalid Date|\[object|reclassified|still down/,
              text
            )
      }
})

test('2026-10-20: the all-clear names the start the first alert gave', () => {
  // Xfinity moved the start from 7:32 to 10:32 AM while the outage lasted,
  // and the all-clear once said "the outage that started at 10:32 AM".
  const runs = replay([
    [CLEARED, '2026-10-20T14:30:20Z'],
    [OUTAGE_1020, '2026-10-20T14:45:57Z'],
    [MOVED_1020, '2026-10-20T19:17:32Z'],
    [CLEARED, '2026-10-20T19:31:12Z']
  ])
  assert.match(runs[1].telegram, /started at 7:32 AM PDT/)
  assert.equal(runs[2].telegram, '')
  assert.match(
    runs[3].telegram,
    /cleared the outage that started at 7:32 AM PDT\./
  )
})

test('the first-reported start falls back, and resets for a new outage', () => {
  const t = '2026-10-20T19:17:32Z'
  const legacy = state(OUTAGE_1020, t)
  assert.equal(
    carryOver(legacy, state(MOVED_1020, t)).reportedStart,
    '2026-10-20T07:32:17-07:00'
  )
  const other = listed({ id: 'OUTAGE-2' })
  assert.equal(carryOver(legacy, state(other, t)).reportedStart, START)
  const tech = carryOver(legacy, state(notice(), t))
  assert.equal(tech.reportedStart, null)
  assert.equal(tech.followsOutage.reportedStart, '2026-10-20T07:32:17-07:00')
  assert.equal(carryOver(tech, state(CLEARED, t)).followsOutage, null)
})

const slack = (old, next) => buildSlack(old, next)

test('Slack: the start and the all-clear, with the Telegram titles', () => {
  const quiet = state(CLEARED, '2026-10-20T14:30:20Z')
  const down = {
    ...carryOver(quiet, state(OUTAGE_1020, '2026-10-20T14:45:57Z')),
    building: { checked: 5, withOutage: 5, sameAsHome: 5 }
  }
  assert.equal(
    slack(quiet, down),
    ':red_circle: *Xfinity: Internet is down*\n' +
      'An unplanned outage started at 7:32 AM PDT, affecting Internet.' +
      ' Xfinity estimates restoration by 10/20/2026 06:55 PM (Pacific).' +
      ' Same outage at 5 of 5 other apartments checked in your building.'
  )
  assert.equal(
    slack(down, carryOver(down, state(CLEARED, '2026-10-20T19:31:12Z'))),
    ':large_green_circle: *Xfinity: Internet is back*\n' +
      'Xfinity has cleared the outage that started at 7:32 AM PDT.' +
      ' It was still listed at 7:45 AM PDT and gone by 12:31 PM PDT.'
  )
  const planned = state(listed({ planned: true }), '2026-10-20T04:15:20Z')
  assert.match(
    slack(state(CLEARED, '2026-10-20T04:00:20Z'), planned),
    /^:red_circle: \*Xfinity: Internet is down \(planned maintenance\)\*\nPlanned maintenance started at 9:06 PM PDT/
  )
})

test('Slack gets nothing for estimates, notices, building news or maintenance ahead', () => {
  const t = '2026-10-20T19:31:20Z'
  const quiet = state(CLEARED, t)
  const tech = state(notice(), t)
  const before = state(listed({ etr: ETR, etrDisplay: ETR_DISPLAY }), t)
  const later = state(listed({ etr: '2026-10-20T02:00:00-07:00' }), t)
  const ahead = state(
    listed({ planned: true, start: '2026-10-22T00:00:00-07:00' }),
    '2026-10-20T04:15:20Z'
  )
  assert.equal(slack(quiet, tech), '')
  assert.equal(slack(tech, quiet), '')
  assert.equal(slack(before, later), '')
  assert.equal(slack(quiet, ahead), '')
  assert.equal(slack(ahead, state(CLEARED, '2026-10-20T04:30:20Z')), '')
  const down = carryOver(null, state(OUTAGE_1020, t))
  assert.equal(slack(down, carryOver(down, tech)), '')
  const alert = {
    ...quiet,
    buildingEvents: [{ type: 'building_outage', count: 2, checked: 5 }]
  }
  assert.equal(slack(quiet, alert), '')
})

test('Slack text escapes Xfinity text and leaves out a missing start', () => {
  const t = '2026-10-20T19:31:20Z'
  const odd = {
    ...OUTAGE_1020,
    outageInfoResponseList: [
      { outageId: 'X', services: ['TV & <Internet>'], startTime: null }
    ],
    customerMessage: {
      ...OUTAGE_1020.customerMessage,
      etr: null,
      etrOutputString: null
    }
  }
  assert.equal(
    slack(state(CLEARED, t), state(odd, t)),
    ':red_circle: *Xfinity: Internet is down*\n' +
      'An unplanned outage is affecting TV &amp; &lt;Internet&gt;.' +
      ' Xfinity has not given a restore time yet.'
  )
})

// Review 4, finding 4: the Slack lines did not always pair.
test('Slack lines always pair: one start and one clear per stretch of outage', () => {
  const other = listed({ id: 'OUTAGE-2', start: '2026-10-20T08:00:00-07:00' })
  const ahead = listed({
    id: 'MAINT-2',
    planned: true,
    start: '2026-10-25T00:00:00-07:00'
  })
  const sequences = [
    [OUTAGE_1020, other, CLEARED],
    [OUTAGE_1020, ahead, CLEARED],
    [OUTAGE_1020, notice(), OUTAGE_1020, notice(), CLEARED],
    [ahead, notice(), CLEARED, OUTAGE_1020, CLEARED],
    [notice(), OUTAGE_1020, CLEARED]
  ]
  const t0 = Date.parse('2026-10-20T15:00:20Z')
  for (const seq of sequences) {
    const runs = replay(
      [CLEARED, ...seq].map((p, i) => [
        p,
        new Date(t0 + i * 900_000).toISOString()
      ])
    )
    const posts = runs.map(r => r.slack.split('\n')[0]).filter(Boolean)
    assert.deepEqual(
      posts,
      [
        ':red_circle: *Xfinity: Internet is down*',
        ':large_green_circle: *Xfinity: Internet is back*'
      ],
      JSON.stringify(seq.map(p => p.customerMessage?.outageType ?? 'none'))
    )
  }
})

// Review 4, finding 5: a notice between two listings of the same outage.
test('an outage that flips through a notice keeps its first start', () => {
  const runs = replay([
    [CLEARED, '2026-10-20T14:30:20Z'],
    [OUTAGE_1020, '2026-10-20T14:45:57Z'],
    [notice(), '2026-10-20T19:31:12Z'],
    [MOVED_1020, '2026-10-20T19:46:12Z'],
    [notice(), '2026-10-20T20:01:12Z'],
    [CLEARED, '2026-10-20T20:16:12Z']
  ])
  assert.match(
    runs[3].telegram,
    /^<b>Xfinity: Internet is down<\/b>\n\nAn unplanned outage started at 7:32 AM PDT/
  )
  assert.match(
    runs[4].telegram,
    /no longer lists the outage that started at 7:32 AM PDT/
  )
  assert.match(
    runs[5].telegram,
    /cleared the outage that started at 7:32 AM PDT and the/
  )
  assert.equal(runs.filter(r => r.slack).length, 2)
})

// Review 4, finding 6: maintenance scheduled ahead that turns into a notice.
test('maintenance ahead that turns into a notice is removed, and the notice is news', () => {
  const ahead = listed({ planned: true, start: '2026-10-25T00:00:00-07:00' })
  const runs = replay([
    [ahead, '2026-10-20T19:16:20Z'],
    [notice(), '2026-10-20T19:31:20Z'],
    [CLEARED, '2026-10-20T19:46:20Z']
  ])
  assert.match(
    runs[1].telegram,
    /^<b>Xfinity: Planned maintenance removed<\/b>/
  )
  assert.match(runs[1].telegram, /<b>Xfinity: Technician in your area<\/b>/)
  assert.equal(runs[2].telegram, '')
  assert.deepEqual(
    runs.map(r => r.slack),
    ['', '', '']
  )
})
