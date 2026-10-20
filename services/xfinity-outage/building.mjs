// Building-wide outage check. Xfinity attaches the same outage ID to every
// affected unit, so other apartments in the building show whether an outage
// is shared or only at the home address. Pure functions: monitor.mjs does the
// fetching, changes.mjs words the messages. Evidence: the Craft note in README.

// Xfinity's "Technician in your area" record. On 2026-10-20 it replaced the
// outage at 12:31 PDT, 14 minutes after Home Assistant was reachable again:
// outageType Informational, Low Impact, no estimate, and text saying work in
// the area may cause brief interruptions. It reports work nearby, not an
// outage.
export function isNotice(msg) {
  return (
    typeof msg?.outageType === 'string' &&
    msg.outageType.trim().toLowerCase() === 'informational'
  )
}

// Neighbors checked per run, at one status call each.
export const MAX_NEIGHBORS = 5
// Neighbors on one unplanned outage ID before a building alert goes out. The
// alert then lasts until no neighbor lists that ID, so a count hovering at
// the threshold does not flap.
export const SHARED_MIN = 2
// An outage the home address has listed is the home's, whatever the neighbors
// show: its records often clear unit by unit. It is remembered for 6 hours
// after the home last listed it, and past that for as long as a neighbor
// still lists it or no run has shown otherwise, up to 7 days.
export const HOME_SEEN_MS = 6 * 60 * 60 * 1000
export const HOME_SEEN_MAX_MS = 7 * 24 * 60 * 60 * 1000

function decodeHome(homeAddress) {
  const raw = String(homeAddress ?? '').replace(/\+/g, ' ')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function splitUnit(text) {
  const ws = String(text ?? '')
    .replace(/,/g, ' ')
    .trim()
    .toUpperCase()
    .split(/\s+/)
  const i = ws.findIndex(w => /^(APT|UNIT|#)$/.test(w))
  if (i < 0 || i + 1 >= ws.length) return null
  return {
    street: ws.slice(0, i).join(' '),
    marker: ws[i],
    unit: ws[i + 1],
    rest: ws.slice(i + 2).join(' ')
  }
}

// The home address in parts, or null when it has no unit, which turns the
// check off. HOME_ADDRESS is URL-encoded ("250+Main+St+Apt+303+..."), unlike
// typeahead entries.
export function homeParts(homeAddress) {
  return splitUnit(decodeHome(homeAddress))
}

// "250 MAIN ST APT SPRINGFIELD CA 94000": the typeahead query for the
// building, which is the home address without its unit number.
export function buildingQuery(homeAddress) {
  const home = homeParts(homeAddress)
  if (!home) return null
  return [home.street, home.marker, home.rest].filter(Boolean).join(' ')
}

// A residential apartment's unit, "APT 816" giving "816" and "APT 3B" giving
// "3B". Null for anything else, such as "UNIT HMOFC" or "APT 710-HMOFC":
// those read as business lines, which may not share residential service.
export function residentialUnit(address) {
  const parts = splitUnit(address)
  if (!parts || parts.marker !== 'APT') return null
  return /^\d[0-9A-Z]*$/.test(parts.unit) ? parts.unit : null
}

// Up to `max` residential neighbors from a typeahead response: the same
// street and the same city, state and ZIP as home, APT units only, the home
// unit and duplicates left out.
export function pickNeighbors(typeahead, homeAddress, max = MAX_NEIGHBORS) {
  const home = homeParts(homeAddress)
  if (!home) return []
  const entries = Array.isArray(typeahead?.addresses) ? typeahead.addresses : []
  const seen = new Set([home.unit])
  const picked = []
  for (const entry of entries) {
    const full = entry?.fullStreetAddress
    if (typeof full !== 'string') continue
    const unit = residentialUnit(full)
    const parts = splitUnit(full)
    if (!unit || seen.has(unit)) continue
    if (parts.street !== home.street || parts.rest !== home.rest) continue
    seen.add(unit)
    picked.push(full)
    if (picked.length >= max) break
  }
  return picked
}

// The status call's address parameter, in the same form as HOME_ADDRESS.
export function neighborParam(address) {
  return encodeURIComponent(address).replace(/%20/g, '+')
}

// An entry's outage ID as a string, or null when it has none: a missing,
// empty or non-scalar ID cannot be matched to anything.
function outageIdOf(entry) {
  const id = entry && typeof entry === 'object' ? entry.outageId : null
  if (typeof id !== 'string' && typeof id !== 'number') return null
  const text = String(id)
  return text.trim() ? text : null
}

// Every outage ID the home address lists. The home messages describe only the
// first entry, but any listed ID makes that outage the home's.
export function homeOutageIds(data) {
  const list = data?.outageInfoResponseList
  if (!Array.isArray(list)) return []
  return [...new Set(list.map(outageIdOf).filter(id => id !== null))]
}

// One neighbor's status call, reduced to what the comparison needs. Anything
// that is not a clear list or one whole outage entry is a failed lookup, so
// it can never read as an all-clear or start an alert.
export function neighborResult(data) {
  const list = data?.outageInfoResponseList
  if (!Array.isArray(list)) return { status: 'error', reason: 'bad body' }
  if (list.length === 0) return { status: 'clear' }
  // Never observed. The address has one customerMessage, so with several
  // entries it is unknown which one is planned or has the estimate.
  if (list.length > 1) return { status: 'error', reason: 'several outages' }
  const outageId = outageIdOf(list[0])
  const msg = data.customerMessage
  if (outageId === null) return { status: 'error', reason: 'bad body' }
  if (!msg || typeof msg !== 'object')
    return { status: 'error', reason: 'bad body' }
  // A notice is no outage: it neither starts a building alert nor keeps one
  // open.
  if (isNotice(msg)) return { status: 'notice' }
  return {
    status: 'outage',
    outageId,
    planned: msg.planned === true,
    startTime: list[0].startTime?.iso ?? null,
    etr: msg.etr?.iso ?? null,
    etrDisplay:
      typeof msg.etrOutputString === 'string' ? msg.etrOutputString : null
  }
}

// A 404 means "Xfinity service is not found in the provided address": no
// Xfinity there, so it is not checked. Anything else is a failed lookup.
export function neighborError(err) {
  if (err?.status === 404) return { status: 'no-service' }
  return { status: 'error', reason: err?.status ?? err?.name ?? 'error' }
}

// The building's state this run, or null when the run gives no evidence:
// a failed lookup, or no neighbor that answered. `homeIds` is every outage ID
// the home address lists. A neighbor with only a notice answered, with no
// outage.
export function summarizeBuilding(results, homeIds = []) {
  if (results.some(r => r.status === 'error')) return null
  const answered = results.filter(
    r => r.status === 'outage' || r.status === 'clear' || r.status === 'notice'
  )
  if (answered.length === 0) return null
  const ids = Object.create(null)
  for (const r of answered) {
    if (r.status !== 'outage') continue
    const entry = (ids[r.outageId] ??= {
      listed: 0,
      unplanned: 0,
      startTime: r.startTime,
      etr: r.etr,
      etrDisplay: r.etrDisplay
    })
    entry.listed++
    if (!r.planned) entry.unplanned++
  }
  const home = new Set(homeIds)
  const listing = answered.filter(r => r.status === 'outage')
  return {
    checked: answered.length,
    withOutage: listing.length,
    sameAsHome: listing.filter(r => home.has(r.outageId)).length,
    ids
  }
}

// Marks a run where the home address has no unit, so the check is off.
export const BUILDING_OFF = Object.freeze({ off: true })

// Adds this run's building result to the new state and decides this run's
// building messages, in one place, because a diff of two states cannot tell
// an outage that ended from one the home address took over.
//
// `summary` is a summary, null for a run without evidence, or BUILDING_OFF.
// `homeIds` is every outage ID the home address lists this run.
// State kept: `buildingAlerts`, the building outages announced and not yet
// closed, and `homeSeen`, when the home address last listed each outage ID.
export function attachBuilding(old, next, summary, homeIds) {
  const now = Date.parse(next.checkedAt)
  const evidence = summary && !summary.off ? summary : null

  const homeSeen = Object.create(null)
  for (const [id, at] of Object.entries(old?.homeSeen ?? {})) {
    const age = now - Date.parse(at)
    // Without evidence, a neighbor may still list it.
    const stillListed = evidence ? (evidence.ids[id]?.listed ?? 0) > 0 : true
    if (age < HOME_SEEN_MS || (stillListed && age < HOME_SEEN_MAX_MS))
      homeSeen[id] = at
  }
  for (const id of homeIds) homeSeen[id] = next.checkedAt
  // State saved before this check existed has no homeSeen: its home outage
  // counts as seen at its last check.
  const legacyId = !old?.homeSeen && old?.hasOutage ? outageIdOf(old) : null
  if (legacyId !== null) homeSeen[legacyId] ??= old.checkedAt ?? next.checkedAt

  const alerts = Object.create(null)
  Object.assign(alerts, old?.buildingAlerts ?? {})
  const events = []
  const result = {
    ...next,
    building: summary ?? null,
    homeSeen: { ...homeSeen }
  }

  // Turned off: nothing was observed ending, so nothing is said.
  if (summary?.off) return { ...result, buildingAlerts: {}, buildingEvents: [] }

  // The home address now lists an announced outage: its own messages cover
  // the rest, so the building alert closes without a word. This needs only
  // the home check, so it holds on runs without neighbor evidence too.
  for (const id of homeIds) delete alerts[id]

  if (evidence) {
    for (const [id, alert] of Object.entries(alerts)) {
      const current = evidence.ids[id]
      if (!current?.listed) {
        delete alerts[id]
        events.push({ type: 'building_cleared', outageId: id, ...alert })
      } else {
        alerts[id] = {
          ...alert,
          count: current.listed,
          checked: evidence.checked,
          etr: current.etr,
          etrDisplay: current.etrDisplay
        }
      }
    }
    for (const [id, entry] of Object.entries(evidence.ids)) {
      if (alerts[id] || homeSeen[id] || entry.unplanned < SHARED_MIN) continue
      alerts[id] = {
        count: entry.listed,
        checked: evidence.checked,
        startTime: entry.startTime,
        etr: entry.etr,
        etrDisplay: entry.etrDisplay
      }
      events.push({ type: 'building_outage', outageId: id, ...alerts[id] })
    }
  }

  return { ...result, buildingAlerts: { ...alerts }, buildingEvents: events }
}

export function buildingChanges(old, next) {
  return next.buildingEvents ?? []
}
