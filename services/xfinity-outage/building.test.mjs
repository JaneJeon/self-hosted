import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attachBuilding,
  buildingChanges,
  buildingQuery,
  neighborError,
  neighborResult,
  pickNeighbors,
  residentialUnit,
  summarizeBuilding
} from './building.mjs'
import { buildMessage, detectChanges, extractState } from './changes.mjs'
import { httpError } from './retry.mjs'

// Values are from 2026-10-20, when 8 of 9 sampled apartments in the building
// carried one outage ID, started 07:32:17 PDT. The street is a stand-in.
const HOME = '100+Main+St+Apt+303+Springfield+CA+94000'
const ID = 'OUT14101723'
const START = '2026-10-20T07:32:17-07:00'
const ETR = '2026-10-20T10:35:00-07:00'
const ETR_DISPLAY = '10/20/2026 10:35 AM (Pacific)'

const typeahead = units => ({
  addresses: units.map(u => ({
    fullStreetAddress: `100 MAIN ST ${u} SPRINGFIELD CA 94000`
  }))
})

const outagePayload = (id = ID) => ({
  outageInfoResponseList: [
    { outageId: id, services: ['Internet'], startTime: { iso: START } }
  ],
  customerMessage: {
    messageType: 'Summary',
    outageType: 'Outage',
    etr: { iso: ETR },
    etrOutputString: ETR_DISPLAY
  }
})
const clearPayload = {
  outageInfoResponseList: [],
  customerMessage: { messageType: 'Summary', etr: null }
}

const outageAt = (id = ID) => neighborResult(outagePayload(id))
const clear = () => neighborResult(clearPayload)
const at = iso => new Date(iso)

function run(old, homePayload, results, iso) {
  const home = extractState(homePayload, at(iso))
  const summary = results ? summarizeBuilding(results, home.outageId) : null
  const next = attachBuilding(old, home, summary)
  return { next, changes: detectChanges(old, next) }
}

test('the building query is the home address without its unit number', () => {
  assert.equal(buildingQuery(HOME), '100 Main St Apt Springfield CA 94000')
  assert.equal(buildingQuery('100+Main+St+Springfield+CA+94000'), null)
  assert.equal(
    buildingQuery('100 Main St Unit 4B Springfield'),
    '100 Main St Unit Springfield'
  )
})

test('only plain residential APT units count, never business ones', () => {
  assert.equal(residentialUnit('100 MAIN ST APT 816 SPRINGFIELD'), '816')
  assert.equal(residentialUnit('100 MAIN ST UNIT HMOFC SPRINGFIELD'), null)
  assert.equal(residentialUnit('100 MAIN ST APT 710-HMOFC SPRINGFIELD'), null)
  assert.equal(residentialUnit(HOME), '303')
})

test('neighbors skip the home unit, business lines, duplicates and other buildings', () => {
  const data = typeahead([
    'APT 303',
    'APT 816',
    'UNIT HMOFC',
    'APT 710-HMOFC',
    'APT 816',
    'APT 412'
  ])
  data.addresses.push({
    fullStreetAddress: '1000 MAIN ST APT 101 SPRINGFIELD CA 94000'
  })
  assert.deepEqual(pickNeighbors(data, HOME), [
    '100 MAIN ST APT 816 SPRINGFIELD CA 94000',
    '100 MAIN ST APT 412 SPRINGFIELD CA 94000'
  ])
  const many = typeahead([
    'APT 101',
    'APT 102',
    'APT 103',
    'APT 104',
    'APT 105',
    'APT 106',
    'APT 107'
  ])
  assert.equal(pickNeighbors(many, HOME).length, 6)
})

test('a 404 means no Xfinity service there, and is not counted', () => {
  // The body Xfinity returned for one unit on 2026-10-20.
  const notFound = httpError('Outage API returned HTTP 404', 404)
  assert.deepEqual(neighborError(notFound), { status: 'no-service' })
  assert.deepEqual(neighborError(httpError('boom', 500)), { status: 'error' })
  const summary = summarizeBuilding(
    [outageAt(), outageAt(), { status: 'no-service' }],
    ID
  )
  assert.equal(summary.checked, 2)
  assert.equal(summary.sameAsHome, 2)
})

test('any failed lookup means no building decision this run', () => {
  assert.equal(summarizeBuilding([outageAt(), { status: 'error' }]), null)
})

test('2026-10-20: the home outage message says the neighbors share it', () => {
  const quiet = run(
    null,
    clearPayload,
    [clear(), clear()],
    '2026-10-20T14:30:20Z'
  ).next
  const { next, changes } = run(
    quiet,
    outagePayload(),
    [outageAt(), outageAt(), outageAt(), outageAt(), outageAt()],
    '2026-10-20T14:45:20Z'
  )
  assert.deepEqual(
    changes.map(c => c.type),
    ['new_outage']
  )
  assert.match(
    buildMessage(changes, next),
    /\nSame outage at 5 of 5 other apartments checked in your building\.$/
  )
})

test('a home outage no neighbor shares says it may be only your line', () => {
  const quiet = run(null, clearPayload, [clear()], '2026-10-20T14:30:20Z').next
  const { next, changes } = run(
    quiet,
    outagePayload(),
    [clear(), clear(), clear()],
    '2026-10-20T14:45:20Z'
  )
  assert.match(
    buildMessage(changes, next),
    /\nNot listed at the 3 other apartments checked in your building, so it may be only your line\.$/
  )
})

test('neighbors sharing an outage the home address does not list get their own alert', () => {
  const quiet = run(
    null,
    clearPayload,
    [clear(), clear()],
    '2026-10-20T14:30:20Z'
  ).next
  const down = run(
    quiet,
    clearPayload,
    [outageAt(), outageAt(), outageAt(), clear()],
    '2026-10-20T14:45:20Z'
  )
  assert.deepEqual(
    down.changes.map(c => c.type),
    ['building_outage']
  )
  assert.equal(
    buildMessage(down.changes, down.next),
    '<b>Xfinity: Outage in your building</b>\n\n' +
      'Xfinity lists an outage at 3 of 4 other apartments checked in your building, started at 7:32 AM PDT. ' +
      'It is not listed at your address.\n' +
      'Xfinity estimates restoration by 10/20/2026 10:35 AM (Pacific).'
  )

  const same = run(
    down.next,
    clearPayload,
    [outageAt(), outageAt(), clear(), clear()],
    '2026-10-20T15:00:20Z'
  )
  assert.deepEqual(same.changes, [])

  const up = run(
    same.next,
    clearPayload,
    [clear(), clear(), clear()],
    '2026-10-20T15:15:20Z'
  )
  assert.equal(
    buildMessage(up.changes, up.next),
    '<b>Xfinity: Building outage cleared</b>\n\n' +
      'Xfinity no longer lists the outage that started at 7:32 AM PDT at the other apartments checked in your building.'
  )
})

test('one neighbor alone is not a building outage', () => {
  const quiet = run(null, clearPayload, [clear()], '2026-10-20T14:30:20Z').next
  const { changes } = run(
    quiet,
    clearPayload,
    [outageAt(), clear(), clear()],
    '2026-10-20T14:45:20Z'
  )
  assert.deepEqual(changes, [])
})

test('a failed check keeps the last building result and sends nothing', () => {
  const quiet = run(null, clearPayload, [clear()], '2026-10-20T14:30:20Z').next
  const down = run(
    quiet,
    clearPayload,
    [outageAt(), outageAt()],
    '2026-10-20T14:45:20Z'
  ).next
  const failed = run(
    down,
    clearPayload,
    [outageAt(), { status: 'error' }],
    '2026-10-20T15:00:20Z'
  )
  assert.deepEqual(failed.changes, [])
  assert.equal(failed.next.buildingOnly.outageId, ID)
  const off = run(down, clearPayload, null, '2026-10-20T15:00:20Z')
  assert.deepEqual(off.changes, [])
})

test('when the home address joins a building outage, only the home message is sent', () => {
  const quiet = run(null, clearPayload, [clear()], '2026-10-20T14:30:20Z').next
  const building = run(
    quiet,
    clearPayload,
    [outageAt(), outageAt()],
    '2026-10-20T14:45:20Z'
  ).next
  const joined = run(
    building,
    outagePayload(),
    [outageAt(), outageAt()],
    '2026-10-20T15:00:20Z'
  )
  assert.deepEqual(
    joined.changes.map(c => c.type),
    ['new_outage']
  )
  assert.match(
    buildMessage(joined.changes, joined.next),
    /Same outage at 2 of 2/
  )
})

test('when the home outage clears but neighbors still list it, both are said', () => {
  const quiet = run(null, clearPayload, [clear()], '2026-10-20T14:30:20Z').next
  const down = run(
    quiet,
    outagePayload(),
    [outageAt(), outageAt()],
    '2026-10-20T14:45:20Z'
  ).next
  const { next, changes } = run(
    down,
    clearPayload,
    [outageAt(), outageAt()],
    '2026-10-20T15:00:20Z'
  )
  assert.deepEqual(
    changes.map(c => c.type),
    ['resolved', 'building_outage']
  )
  const text = buildMessage(changes, next)
  assert.match(text, /Xfinity: Internet is back/)
  assert.match(text, /Xfinity: Outage in your building/)
})

test('state saved before this feature loads without any building message', () => {
  // The state Railway holds at deploy has no building fields.
  const legacy = extractState(outagePayload(), at('2026-10-20T15:30:20Z'))
  const { changes } = run(
    legacy,
    outagePayload(),
    [outageAt(), outageAt()],
    '2026-10-20T15:45:20Z'
  )
  assert.deepEqual(changes, [])
})

test('no building message shows null, undefined, NaN or Invalid Date', () => {
  const sets = [
    [clear(), clear()],
    [outageAt(), outageAt()],
    [outageAt('OTHER'), outageAt('OTHER'), clear()],
    [outageAt(), clear()],
    [{ status: 'no-service' }],
    [],
    null
  ]
  const homes = [clearPayload, outagePayload(), outagePayload('OTHER')]
  for (const h1 of homes)
    for (const s1 of sets)
      for (const h2 of homes)
        for (const s2 of sets) {
          const first = run(null, h1, s1, '2026-10-20T14:30:20Z').next
          const { next, changes } = run(first, h2, s2, '2026-10-20T14:45:20Z')
          const text = buildMessage(changes, next)
          assert.doesNotMatch(text, /null|undefined|NaN|Invalid Date/, text)
        }
})
