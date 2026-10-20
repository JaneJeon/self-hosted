import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILDING_OFF,
  attachBuilding,
  buildingQuery,
  homeOutageIds,
  homeParts,
  neighborError,
  neighborParam,
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
const X = 'OUT14101723'
const Y = 'OUT99999999'
const START = '2026-10-20T07:32:17-07:00'
const ETR = '2026-10-20T10:35:00-07:00'
const ETR_DISPLAY = '10/20/2026 10:35 AM (Pacific)'

const typeahead = units => ({
  addresses: units.map(u => ({
    fullStreetAddress: `100 MAIN ST ${u} SPRINGFIELD CA 94000`
  }))
})

const outagePayload = (id = X, extra = {}) => ({
  outageInfoResponseList: [
    { outageId: id, services: ['Internet'], startTime: { iso: START } }
  ],
  customerMessage: {
    messageType: 'Summary',
    outageType: 'Outage',
    etr: { iso: ETR },
    etrOutputString: ETR_DISPLAY,
    ...extra
  }
})
const clearPayload = {
  outageInfoResponseList: [],
  customerMessage: { messageType: 'Summary', etr: null }
}

const out = (id = X) => neighborResult(outagePayload(id))
const clear = () => neighborResult(clearPayload)
const at = iso => new Date(iso)

// One run: the home payload, the neighbor results (or null for a run without
// evidence, or BUILDING_OFF), and the minute past 07:00 PDT.
function run(old, homePayload, results, minute) {
  const iso = new Date(Date.parse('2026-10-20T14:00:20Z') + minute * 60_000)
  const home = extractState(homePayload, iso)
  const homeIds = homeOutageIds(homePayload)
  const summary =
    results === BUILDING_OFF
      ? BUILDING_OFF
      : results
      ? summarizeBuilding(results, homeIds)
      : null
  const next = attachBuilding(old, home, summary, homeIds)
  const changes = detectChanges(old, next)
  return { next, changes, text: buildMessage(changes, next) }
}

// Runs a sequence and returns the messages sent, one entry per run.
function sequence(steps) {
  let state = null
  return steps.map(([home, results], i) => {
    const r = run(state, home, results, 15 * i)
    state = r.next
    return r.text
  })
}

test('the building query is the home address without its unit number', () => {
  assert.equal(buildingQuery(HOME), '100 MAIN ST APT SPRINGFIELD CA 94000')
  assert.equal(buildingQuery('100+Main+St+Springfield+CA+94000'), null)
  assert.equal(
    buildingQuery('100+Main+St+Apt+50%+Springfield'),
    '100 MAIN ST APT SPRINGFIELD'
  )
})

test('only plain residential APT units count, never business ones', () => {
  assert.equal(residentialUnit('100 MAIN ST APT 816 SPRINGFIELD'), '816')
  assert.equal(residentialUnit('100 MAIN ST UNIT HMOFC SPRINGFIELD'), null)
  assert.equal(residentialUnit('100 MAIN ST APT 710-HMOFC SPRINGFIELD'), null)
})

test('neighbors must match the street, city, state and ZIP exactly', () => {
  const data = typeahead([
    'APT 303',
    'APT 816',
    'UNIT HMOFC',
    'APT 710-HMOFC',
    'APT 816',
    'APT 412'
  ])
  data.addresses.push(
    { fullStreetAddress: '1000 MAIN ST APT 101 SPRINGFIELD CA 94000' },
    { fullStreetAddress: '100 MAIN ST W APT 102 SPRINGFIELD CA 94000' },
    { fullStreetAddress: '100 MAIN ST APT 103 SHELBYVILLE CA 94001' },
    { fullStreetAddress: '100 MAIN ST APT 104 100% SPRINGFIELD CA 94000' },
    { fullStreetAddress: null },
    { notAnAddress: true }
  )
  assert.deepEqual(pickNeighbors(data, HOME), [
    '100 MAIN ST APT 816 SPRINGFIELD CA 94000',
    '100 MAIN ST APT 412 SPRINGFIELD CA 94000'
  ])
  assert.deepEqual(pickNeighbors({ addresses: 5 }, HOME), [])
  assert.deepEqual(pickNeighbors(null, HOME), [])
})

test('a home written with Unit still excludes its own APT entry', () => {
  const home = '100+Main+St+Unit+303+Springfield+CA+94000'
  assert.equal(homeParts(home).unit, '303')
  assert.deepEqual(pickNeighbors(typeahead(['APT 303', 'APT 304']), home), [
    '100 MAIN ST APT 304 SPRINGFIELD CA 94000'
  ])
})

test('at most five neighbors are checked', () => {
  const many = typeahead([
    'APT 101',
    'APT 102',
    'APT 103',
    'APT 104',
    'APT 105',
    'APT 106'
  ])
  assert.equal(pickNeighbors(many, HOME).length, 5)
})

test('a 404 means no Xfinity service; a malformed body is a failure', () => {
  assert.deepEqual(neighborError(httpError('HTTP 404', 404)), {
    status: 'no-service'
  })
  assert.equal(neighborError(httpError('HTTP 500', 500)).status, 'error')
  for (const bad of [
    null,
    'str',
    {},
    { error: { errorCode: 500 } },
    { outageInfoResponseList: {} }
  ])
    assert.equal(neighborResult(bad).status, 'error', JSON.stringify(bad))
})

test('planned maintenance at a neighbor cannot start a building alert', () => {
  const planned = neighborResult(outagePayload(X, { planned: true }))
  assert.equal(planned.status, 'outage')
  assert.equal(planned.planned, true)
  const sent = sequence([
    [clearPayload, [clear()]],
    [clearPayload, [planned, planned, planned]]
  ])
  assert.equal(sent[1], '')
})

test('no evidence is not an all-clear: failures, zero answers and empty lists', () => {
  assert.equal(summarizeBuilding([out(), { status: 'error' }]), null)
  assert.equal(summarizeBuilding([{ status: 'no-service' }]), null)
  assert.equal(summarizeBuilding([]), null)
  const sent = sequence([
    [clearPayload, [clear(), clear()]],
    [clearPayload, [out(), out(), clear()]],
    [clearPayload, []],
    [clearPayload, [{ status: 'no-service' }]],
    [clearPayload, [out(), neighborResult({ error: {} })]],
    [clearPayload, null],
    [clearPayload, [out(), out()]]
  ])
  assert.match(sent[1], /Outage in your building/)
  assert.deepEqual(sent.slice(2), ['', '', '', '', ''])
})

test('2026-10-20: the home outage message says the neighbors share it', () => {
  const sent = sequence([
    [clearPayload, [clear(), clear()]],
    [outagePayload(), [out(), out(), out(), out(), out()]]
  ])
  assert.match(sent[1], /^<b>Xfinity: Internet is down<\/b>/)
  assert.match(
    sent[1],
    /\nSame outage at 5 of 5 other apartments checked in your building\.$/
  )
})

test('a home outage no neighbor shares may be only your line', () => {
  const [, alone, different] = sequence([
    [clearPayload, [clear()]],
    [outagePayload(), [clear(), clear(), clear()]],
    [clearPayload, [clear()]]
  ])
  assert.match(
    alone,
    /\nNot listed at the 3 other apartments checked in your building, so it may be only your line\.$/
  )
  const [, mixed] = sequence([
    [clearPayload, [clear()]],
    [outagePayload(), [out(Y), clear(), clear()]]
  ])
  assert.match(
    mixed,
    /Not listed at the 3 other apartments checked in your building \(1 lists a different outage\), so it may be only your line\.$/
  )
  assert.equal(
    different,
    '<b>Xfinity: Internet is back</b>\n\nXfinity has cleared the outage that started at 7:32 AM PDT. It was still listed at 7:15 AM PDT and gone by 7:30 AM PDT.'
  )
})

test('planned maintenance messages carry no neighbor line', () => {
  const [, planned] = sequence([
    [clearPayload, [clear()]],
    [outagePayload(X, { planned: true }), [clear(), clear()]]
  ])
  assert.doesNotMatch(planned, /apartments/)
})

test('a building outage the home address does not list: one alert, one all-clear', () => {
  const sent = sequence([
    [clearPayload, [clear(), clear()]],
    [clearPayload, [out(), out(), out(), clear()]],
    [clearPayload, [out(), out(), clear(), clear()]],
    [clearPayload, [clear(), clear(), clear()]]
  ])
  assert.equal(
    sent[1],
    '<b>Xfinity: Outage in your building</b>\n\n' +
      'Xfinity lists an outage at 3 of 4 other apartments checked in your building, started at 7:32 AM PDT. ' +
      'It is not listed at your address.\n' +
      'Xfinity estimates restoration by 10/20/2026 10:35 AM (Pacific).'
  )
  assert.equal(sent[2], '')
  assert.equal(
    sent[3],
    '<b>Xfinity: Building outage cleared</b>\n\n' +
      'Xfinity no longer lists the outage that started at 7:32 AM PDT at the other apartments checked in your building.'
  )
})

test('a count hovering at the threshold does not flap', () => {
  const sent = sequence([
    [clearPayload, [clear(), clear()]],
    [clearPayload, [out(), out(), clear()]],
    [clearPayload, [out(), clear(), clear()]],
    [clearPayload, [out(), out(), clear()]],
    [clearPayload, [out(), clear(), clear()]],
    [clearPayload, [clear(), clear(), clear()]]
  ])
  assert.match(sent[1], /Outage in your building/)
  assert.deepEqual(sent.slice(2, 5), ['', '', ''])
  assert.match(sent[5], /Building outage cleared/)
})

test('one neighbor alone is not a building outage', () => {
  const sent = sequence([
    [clearPayload, [clear()]],
    [clearPayload, [out(), clear(), clear()]]
  ])
  assert.equal(sent[1], '')
})

test('when the home address joins a building outage, the home messages take over', () => {
  const sent = sequence([
    [clearPayload, [clear()]],
    [clearPayload, [out(), out()]],
    [outagePayload(), [out(), out()]],
    [clearPayload, [clear(), clear()]]
  ])
  assert.match(sent[1], /Outage in your building/)
  assert.match(
    sent[2],
    /^<b>Xfinity: Internet is down<\/b>[\s\S]*Same outage at 2 of 2/
  )
  assert.match(sent[3], /^<b>Xfinity: Internet is back<\/b>/)
  assert.doesNotMatch(sent[3], /Building outage cleared/)
})

test('one outage clearing in stages sends only the home messages', () => {
  // Home and neighbors on X, the home record clears first.
  const sent = sequence([
    [clearPayload, [clear()]],
    [outagePayload(), [out(), out(), out()]],
    [clearPayload, [out(), out()]],
    [clearPayload, [clear(), clear()]]
  ])
  assert.match(sent[1], /Internet is down/)
  assert.equal(sent[2].includes('Outage in your building'), false)
  assert.match(sent[2], /Internet is back/)
  assert.equal(sent[3], '')
})

test('a building alert keeps its all-clear while a different home outage comes and goes', () => {
  const sent = sequence([
    [clearPayload, [clear()]],
    [clearPayload, [out(X), out(X)]],
    [outagePayload(Y), [out(X), out(X)]],
    [outagePayload(Y), [clear(), clear()]],
    [clearPayload, [clear(), clear()]]
  ])
  assert.match(sent[1], /Outage in your building/)
  assert.doesNotMatch(sent[2], /Outage in your building/)
  assert.match(sent[3], /Building outage cleared/)
  assert.match(sent[4], /Internet is back/)
  assert.doesNotMatch(sent[4], /building/i)
})

test('home planned maintenance does not hide a real building outage', () => {
  const sent = sequence([
    [clearPayload, [clear()]],
    [outagePayload(Y, { planned: true }), [out(X), out(X), out(X)]]
  ])
  assert.match(sent[1], /Outage in your building/)
})

test('two building outages are tracked and closed separately', () => {
  const sent = sequence([
    [clearPayload, [clear()]],
    [clearPayload, [out(X), out(X), out(Y), out(Y)]],
    [clearPayload, [out(X), out(X), out(Y), out(Y), out(Y)]],
    [clearPayload, [out(Y), out(Y), out(Y)]],
    [clearPayload, [clear(), clear()]]
  ])
  assert.equal(sent[1].match(/Outage in your building/g).length, 2)
  assert.equal(sent[2], '')
  assert.equal(sent[3].match(/Building outage cleared/g).length, 1)
  assert.doesNotMatch(sent[3], /Outage in your building/)
  assert.equal(sent[4].match(/Building outage cleared/g).length, 1)
})

test('turning the check off drops a tracked building outage silently', () => {
  const sent = sequence([
    [clearPayload, [clear()]],
    [clearPayload, [out(), out()]],
    [clearPayload, BUILDING_OFF]
  ])
  assert.equal(sent[2], '')
})

test('state saved before this feature loads without any building message', () => {
  const legacy = extractState(outagePayload(), at('2026-10-20T15:30:20Z'))
  const same = run(legacy, outagePayload(), [out(), out()], 105)
  assert.deepEqual(same.changes, [])
  const cleared = run(legacy, clearPayload, [out(), out()], 105)
  assert.deepEqual(
    cleared.changes.map(c => c.type),
    ['resolved']
  )
})

test('text from Xfinity cannot open an HTML tag in the Telegram message', () => {
  const nasty = outagePayload(X, { etrOutputString: '<b>soon</b> & later' })
  const [, home] = sequence([
    [clearPayload, [clear()]],
    [nasty, [clear()]]
  ])
  assert.match(home, /&lt;b&gt;soon&lt;\/b&gt; &amp; later/)
  const [, building] = sequence([
    [clearPayload, [clear()]],
    [clearPayload, [neighborResult(nasty), neighborResult(nasty)]]
  ])
  assert.match(building, /&lt;b&gt;soon&lt;\/b&gt; &amp; later/)
})

test('an unreadable neighbor start time is left out, never "Invalid Date"', () => {
  const tbd = {
    ...outagePayload(),
    outageInfoResponseList: [{ outageId: X, startTime: { iso: 'TBD' } }]
  }
  const sent = sequence([
    [clearPayload, [clear()]],
    [clearPayload, [neighborResult(tbd), neighborResult(tbd)]],
    [clearPayload, [clear(), clear()]]
  ])
  assert.match(sent[1], /checked in your building\. It is not listed/)
  assert.equal(
    sent[2],
    '<b>Xfinity: Building outage cleared</b>\n\nXfinity no longer lists the outage at the other apartments checked in your building.'
  )
})

test('no building message shows null, undefined, NaN, Invalid Date or unknown time', () => {
  const sets = [
    [clear(), clear()],
    [out(), out()],
    [out(Y), out(Y), clear()],
    [out(), clear()],
    [{ status: 'no-service' }],
    [],
    null,
    BUILDING_OFF
  ]
  const homes = [
    clearPayload,
    outagePayload(),
    outagePayload(Y),
    outagePayload(Y, { planned: true })
  ]
  for (const h1 of homes)
    for (const s1 of sets)
      for (const h2 of homes)
        for (const s2 of sets) {
          const first = run(null, h1, s1, 0).next
          const { text } = run(first, h2, s2, 15)
          assert.doesNotMatch(
            text,
            /null|undefined|NaN|Invalid Date|unknown time/,
            text
          )
        }
})

// Second review, 2026-10-20: sequences its enumeration found.

test('a takeover on a run without neighbor evidence still closes the alert silently', () => {
  const sent = sequence([
    [clearPayload, [clear()]],
    [clearPayload, [out(), out()]],
    [outagePayload(), null],
    [clearPayload, [out(), out()]],
    [clearPayload, [clear(), clear()]]
  ])
  assert.match(sent[1], /Outage in your building/)
  assert.match(sent[2], /^<b>Xfinity: Internet is down<\/b>/)
  assert.doesNotMatch(sent[2], /apartments/)
  assert.match(sent[3], /^<b>Xfinity: Internet is back<\/b>/)
  assert.doesNotMatch(sent[3], /building/i)
  assert.equal(sent[4], '')
})

test('an outage the home listed in the last 6 hours is never announced as the building', () => {
  const sent = sequence([
    [clearPayload, [clear()]],
    [outagePayload(), null],
    [clearPayload, null],
    [clearPayload, [out(), out()]],
    [clearPayload, [clear(), clear()]]
  ])
  assert.match(sent[2], /Internet is back/)
  assert.deepEqual(sent.slice(3), ['', ''])
  const rising = sequence([
    [clearPayload, [clear()]],
    [outagePayload(), [out(), clear()]],
    [clearPayload, [out(), clear()]],
    [clearPayload, [out(), out()]]
  ])
  assert.equal(rising[3], '')
})

// Review 3, N4: the home took over a building alert and came back, and the
// neighbors still listed the outage more than 6 hours later.
test('an outage the home listed stays its own while a neighbor lists it, past 6 hours', () => {
  let state = run(null, clearPayload, [clear()], 0).next
  state = run(state, clearPayload, [out(), out()], 15).next
  state = run(state, outagePayload(), [out(), out()], 30).next
  state = run(state, clearPayload, [out(), out()], 45).next
  const later = run(state, clearPayload, [out(), out()], 45 + 6 * 60 + 15)
  assert.equal(later.text, '')
  const gone = run(
    later.next,
    clearPayload,
    [clear(), clear()],
    45 + 6 * 60 + 30
  )
  assert.equal(gone.text, '')
})

// Review 3, N1b: a run that fails is not saved, so the next saved run can
// come hours after the last one.
test('6 hours or more between saved runs: the home outage is not announced as the building', () => {
  let state = run(null, clearPayload, [clear()], 0).next
  state = run(state, outagePayload(), [out(), out()], 15).next
  const later = run(state, clearPayload, [out(), out(), clear()], 15 + 375)
  assert.match(later.text, /Internet is back/)
  assert.doesNotMatch(later.text, /building/i)
})

test('once no neighbor lists it, the home outage is forgotten 6 hours on', () => {
  let state = run(null, clearPayload, [clear()], 0).next
  state = run(state, outagePayload(), [out(), out()], 15).next
  state = run(state, clearPayload, [clear(), clear()], 30).next
  assert.ok(X in state.homeSeen)
  state = run(state, clearPayload, [clear(), clear()], 15 + 6 * 60).next
  assert.equal(X in state.homeSeen, false)
  // Records that come back after that read as a building outage.
  const back = run(state, clearPayload, [out(), out()], 15 + 6 * 60 + 15)
  assert.match(back.text, /Outage in your building/)
})

test('without neighbor evidence the home outage is kept past 6 hours, up to 7 days', () => {
  let state = run(null, clearPayload, [clear()], 0).next
  state = run(state, outagePayload(), [out(), out()], 15).next
  state = run(state, clearPayload, null, 15 + 7 * 60).next
  assert.ok(X in state.homeSeen)
  const evidence = run(state, clearPayload, [out(), out()], 15 + 7 * 60 + 15)
  assert.equal(evidence.text, '')
  state = run(evidence.next, clearPayload, null, 15 + 7 * 24 * 60).next
  assert.equal(X in state.homeSeen, false)
})

// Review 3, N3: a home list of [Y, X] was read as Y only.
test('an outage anywhere in the home list is the home outage', () => {
  const both = outagePayload(Y)
  both.outageInfoResponseList.push({
    outageId: X,
    services: ['Internet'],
    startTime: { iso: START }
  })
  assert.deepEqual(homeOutageIds(both), [Y, X])
  const sent = sequence([
    [clearPayload, [clear()]],
    [both, [out(X), out(X)]]
  ])
  assert.match(sent[1], /Internet is down/)
  assert.match(sent[1], /Same outage at 2 of 2 other apartments/)
  assert.doesNotMatch(sent[1], /Outage in your building/)
  // Review 2, F2: the home lists X with no customerMessage, so the home side
  // reads no outage, but X is still listed at the home address.
  const bare = {
    outageInfoResponseList: [{ outageId: X, startTime: { iso: START } }],
    customerMessage: null
  }
  const quiet = sequence([
    [clearPayload, [clear()]],
    [bare, [out(), out()]]
  ])
  assert.equal(quiet[1], '')
})

test('the home starting the outage as the neighbors clear sends no building all-clear', () => {
  const sent = sequence([
    [clearPayload, [clear()]],
    [clearPayload, [out(), out()]],
    [outagePayload(), [clear(), clear()]]
  ])
  assert.match(sent[2], /^<b>Xfinity: Internet is down<\/b>/)
  assert.doesNotMatch(sent[2], /Building outage cleared/)
})

test('a planned reclassification keeps the alert until no neighbor lists it', () => {
  const planned = neighborResult(outagePayload(X, { planned: true }))
  const sent = sequence([
    [clearPayload, [clear()]],
    [clearPayload, [out(), out()]],
    [clearPayload, [planned, planned]],
    [clearPayload, [clear(), clear()]]
  ])
  assert.equal(sent[2], '')
  assert.match(sent[3], /Building outage cleared/)
})

test('entries without an outage ID or a customer message are failed lookups', () => {
  for (const bad of [
    {
      outageInfoResponseList: [{ services: ['Internet'] }],
      customerMessage: {}
    },
    { outageInfoResponseList: [null], customerMessage: {} },
    { outageInfoResponseList: [{ outageId: X }], customerMessage: null }
  ])
    assert.equal(neighborResult(bad).status, 'error', JSON.stringify(bad))
})

test('numeric outage IDs compare equal to the home one', () => {
  const numeric = {
    ...outagePayload(),
    outageInfoResponseList: [{ outageId: 14101723, startTime: { iso: START } }]
  }
  const sent = sequence([
    [clearPayload, [clear()]],
    [numeric, [neighborResult(numeric), neighborResult(numeric)]]
  ])
  assert.match(sent[1], /Same outage at 2 of 2/)
  assert.doesNotMatch(sent[1], /Outage in your building/)
})

test('neighbor addresses are URL-encoded for the status call', () => {
  assert.equal(
    neighborParam('1 A&B PLAZA APT 4 CITY CA 94000'),
    '1+A%26B+PLAZA+APT+4+CITY+CA+94000'
  )
  assert.equal(neighborParam('1 MAIN ST APT #4'), '1+MAIN+ST+APT+%234')
})

test('an outage ID such as __proto__ cannot touch shared objects', () => {
  const evil = neighborResult({
    outageInfoResponseList: [{ outageId: '__proto__' }],
    customerMessage: {}
  })
  const summary = summarizeBuilding([evil, evil])
  assert.equal({}.listed, undefined)
  assert.equal(summary.ids['__proto__'].listed, 2)
})

// Review 3, N2 and N2b: an outage ID of "" passed as an ID.
test('a neighbor entry without a usable ID, or with several outages, is a failed lookup', () => {
  for (const id of ['', '  ', {}, [X], true])
    assert.equal(neighborResult(outagePayload(id)).status, 'error')
  const two = outagePayload(X)
  two.outageInfoResponseList.push({ outageId: Y })
  assert.deepEqual(neighborResult(two), {
    status: 'error',
    reason: 'several outages'
  })
  assert.equal(neighborResult(outagePayload(42)).outageId, '42')
})

test('a home outage without a usable ID sends no building alert', () => {
  const blank = () => neighborResult(outagePayload(''))
  assert.deepEqual(homeOutageIds(outagePayload('')), [])
  const sent = sequence([
    [clearPayload, [clear()]],
    [outagePayload(''), [blank(), blank(), clear()]]
  ])
  assert.match(sent[1], /Internet is down/)
  assert.doesNotMatch(sent[1], /building|apartment/i)
})

// Review 3, issue 6: "restoration by [object Object]".
test('estimate text that is not a string is not printed', () => {
  for (const shown of [{}, 123, true, ['a', 'b']]) {
    const r = neighborResult(outagePayload(X, { etrOutputString: shown }))
    assert.equal(r.etrDisplay, null)
    const building = sequence([
      [clearPayload, [clear()]],
      [clearPayload, [r, r]]
    ])
    assert.match(building[1], /restoration by/)
    assert.doesNotMatch(building[1], /\[object|123|true|a,b/)
    const home = sequence([
      [clearPayload, [clear()]],
      [outagePayload(X, { etrOutputString: shown }), [clear()]]
    ])
    assert.match(home[1], /Internet is down/)
    assert.doesNotMatch(home[1], /\[object|123|true|a,b/)
  }
})
