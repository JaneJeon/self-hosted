import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMessage,
  carryOver,
  detectChanges,
  extractState
} from './changes.mjs'

const CHECK = '2026-10-28T15:00:00Z'
const START = '2026-10-29T09:30:00-07:00'
const END = '2026-10-29T11:00:00-07:00'
const ETR = '2026-10-29T12:00:00-07:00'
const ADDRESS = '123 Example St'

function planned({
  start = START,
  end = END,
  etr = null,
  detail = 'Maintenance on Example St may interrupt Internet.'
} = {}) {
  return {
    outageInfoResponseList: [
      {
        outageId: 'MAINTENANCE-1',
        services: ['Internet'],
        startTime: start == null ? null : { iso: start },
        endTime: end == null ? null : { iso: end }
      }
    ],
    customerMessage: {
      outageType: 'Planned',
      planned: true,
      etr: etr == null ? null : { iso: etr },
      etrOutputString: null,
      messages: { detailedDescription: detail }
    }
  }
}

function outage({
  planned: isPlanned = true,
  start = START,
  end = END,
  etr = null
} = {}) {
  const payload = planned({
    start,
    end,
    etr,
    detail: 'Maintenance on Example St.'
  })
  payload.customerMessage.planned = isPlanned
  payload.customerMessage.outageType = isPlanned ? 'Planned' : 'Unplanned'
  return payload
}

const state = (payload, checkedAt = CHECK) =>
  extractState(
    payload,
    new Date(checkedAt),
    ADDRESS.split(' ').slice(1).join(' ')
  )
const changes = (before, after) => detectChanges(before, after)
const message = (before, after) => buildMessage(changes(before, after), after)

test('scheduled maintenance uses endTime as a dated window, not as a promised restore time', () => {
  const current = state(planned({ etr: ETR }))
  const text = buildMessage([{ type: 'new_outage' }], current)

  assert.equal(current.maintenanceEnd, END)
  assert.equal(
    current.maintenanceText,
    'Maintenance on your address may interrupt Internet.'
  )
  assert.match(text, /Planned maintenance scheduled/)
  assert.match(
    text,
    /Scheduled window: 10\/29\/2026, 9:30 AM PDT – 10\/29\/2026, 11:00 AM PDT\./i
  )
  assert.match(
    text,
    /Xfinity estimates restoration by 10\/29\/2026, 12:00 PM PDT\./
  )
  assert.doesNotMatch(text, /has not given an end time/)
  assert.doesNotMatch(JSON.stringify(current), /123 Example St/)
})

test('same-id future start moved by a day updates the planned schedule with its current full date', () => {
  const before = state(planned({ etr: ETR }))
  const after = state(
    planned({ start: '2026-10-30T09:30:00-07:00', etr: ETR }),
    '2026-10-28T15:15:00Z'
  )
  const text = message(before, after)

  assert.match(text, /Planned maintenance update/)
  assert.match(text, /10\/30\/2026, 9:30 AM PDT/)
  assert.doesNotMatch(text, /Internet still down/)
})

test('end-only movement updates the maintenance window', () => {
  const before = state(planned({ etr: ETR }))
  const after = state(
    planned({ end: '2026-10-29T12:00:00-07:00', etr: ETR }),
    '2026-10-28T15:15:00Z'
  )
  const text = message(before, after)

  assert.match(text, /Planned maintenance update/)
  assert.match(text, /10\/29\/2026, 12:00 PM PDT/)
  assert.doesNotMatch(text, /Internet still down/)
})

test('future ETR-only movement is worded as a planned schedule update', () => {
  const before = state(planned({ etr: ETR }))
  const after = state(
    planned({ etr: '2026-10-29T13:00:00-07:00' }),
    '2026-10-28T15:15:00Z'
  )
  const text = message(before, after)

  assert.match(text, /Planned maintenance update/)
  assert.doesNotMatch(text, /Outage ETA|Internet still down/)
})

test('legacy planned state without maintenanceEnd gets one details message, then goes quiet', () => {
  const old = state(planned())
  delete old.maintenanceEnd
  delete old.maintenanceText
  const current = state(planned(), '2026-10-28T15:15:00Z')
  const text = message(old, current)
  const next = carryOver(current, state(planned(), '2026-10-28T15:30:00Z'))

  assert.match(text, /Planned maintenance details/)
  assert.match(text, /10\/29\/2026, 11:00 AM PDT/)
  assert.deepEqual(changes(current, next), [])
  assert.equal(message(current, next), '')
})

test('legacy missing end remains null and does not repeat a migration alert', () => {
  const old = state(planned({ end: null }))
  const current = state(planned({ end: null }), '2026-10-28T15:15:00Z')

  assert.equal(current.maintenanceEnd, null)
  assert.deepEqual(changes(old, current), [])
})

test('a newly listed end time on unchanged maintenance updates the schedule', () => {
  const before = state(planned({ end: null }))
  const after = state(planned({ end: END }), '2026-10-28T15:15:00Z')

  assert.match(message(before, after), /Planned maintenance update/)
  assert.match(message(before, after), /10\/29\/2026, 11:00 AM PDT/)
})

test('invalid end times before start are absent and never formatted as Invalid Date', () => {
  for (const end of ['2026-10-29T08:00:00-07:00', 'not-a-date']) {
    const current = state(planned({ end }))
    const text = buildMessage([{ type: 'new_outage' }], current)

    assert.equal(current.maintenanceEnd, null)
    assert.match(text, /has not given an end time/)
    assert.doesNotMatch(text, /Invalid Date/)
  }
})

test('an unplanned outage endTime does not become a restore estimate', () => {
  const current = state(outage({ planned: false }))
  const text = buildMessage([{ type: 'new_outage' }], current)

  assert.equal(current.maintenanceEnd, null)
  assert.match(text, /has not given a restore time yet/)
  assert.doesNotMatch(text, /11:00 AM PDT|has not given an end time/)
})

test('cross-midnight scheduled window displays dates and offsets across the DST boundary', () => {
  const current = state(
    planned({
      start: '2026-10-31T23:30:00-07:00',
      end: '2026-11-01T01:30:00-08:00'
    }),
    '2026-10-31T15:00:00Z'
  )
  const text = buildMessage([{ type: 'new_outage' }], current)

  assert.match(text, /10\/31\/2026, 11:30 PM PDT/)
  assert.match(text, /11\/1\/2026, 1:30 AM PST/)
})

test('maintenance description is masked and HTML-escaped; unplanned detail is not persisted', () => {
  const current = state(
    planned({ detail: 'Example St <planned> & scheduled.' })
  )
  const unplanned = state(outage({ planned: false }), '2026-10-28T15:15:00Z')

  assert.equal(current.maintenanceText, 'your address <planned> & scheduled.')
  assert.doesNotMatch(JSON.stringify(current), /Example St/)
  assert.match(
    buildMessage([{ type: 'new_outage' }], current),
    /&lt;planned&gt; &amp; scheduled/
  )
  assert.equal(unplanned.maintenanceText, null)
  assert.doesNotMatch(JSON.stringify(unplanned), /Example St/)
})

test('legacy maintenance without an end still corrects the missing date just once', () => {
  const old = state(planned({ end: null }))
  delete old.maintenanceEnd
  delete old.maintenanceText
  const current = carryOver(old, state(planned({ end: null })))
  assert.match(message(old, current), /Planned maintenance details/)
  assert.match(message(old, current), /10\/29\/2026, 9:30 AM PDT/)
  const saved = JSON.parse(JSON.stringify(current))
  assert.equal(
    message(saved, carryOver(saved, state(planned({ end: null })))),
    ''
  )
})

test('equivalent timestamp offsets and a dropped future estimate do not notify', () => {
  const before = state(planned({ etr: ETR }))
  const utc = state(
    planned({
      start: '2026-10-29T16:30:00Z',
      end: '2026-10-29T18:00:00Z',
      etr: ETR
    })
  )
  assert.equal(message(before, utc), '')
  assert.equal(message(before, state(planned())), '')
})

test('an updated maintenance warning is delivered even when its times stay unchanged', () => {
  const before = state(planned())
  const after = state(
    planned({ detail: 'Brief interruptions are now expected.' })
  )
  assert.match(message(before, after), /Brief interruptions are now expected\./)
  assert.doesNotMatch(message(before, after), /Internet still down/)
  assert.equal(
    message(after, state(planned({ detail: after.maintenanceText }))),
    ''
  )
})

test('an existing record marked as future maintenance gets maintenance wording', () => {
  const before = state(outage({ planned: false }))
  const after = state(planned())
  assert.match(message(before, after), /Planned maintenance update/)
  assert.doesNotMatch(
    message(before, after),
    /Outage reclassified|Internet still down/
  )
})
