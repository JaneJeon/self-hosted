// Building-wide outage check. Xfinity attaches the same outage ID to every
// affected unit, so other apartments in the building show whether an outage
// is shared or only at the home address. Pure functions: monitor.mjs does the
// fetching, changes.mjs words the messages. Evidence: the Craft note in README.

// Neighbors checked per run, at one status call each.
export const MAX_NEIGHBORS = 5
// Neighbors on one outage ID before a building outage starts. It then lasts
// until no neighbor lists that ID, so a count hovering at the threshold does
// not flap between alert and all-clear.
export const SHARED_MIN = 2

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

// "250 Main St Apt Springfield CA 94000": the typeahead query for the
// building, which is the home address without its unit number.
export function buildingQuery(homeAddress) {
  const home = homeParts(homeAddress)
  if (!home) return null
  return [home.street, home.marker, home.rest].filter(Boolean).join(' ')
}

// A residential apartment's unit, "APT 816" giving "816". Null for anything
// else, such as "UNIT HMOFC" or "APT 710-HMOFC": those read as business
// lines, which may not share residential service.
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

// One neighbor's status call, reduced to what the comparison needs. Planned
// maintenance does not count: the check is for outages Xfinity does not
// announce. A body without an outage list is a failed lookup, not a clear.
export function neighborResult(data) {
  const list = data?.outageInfoResponseList
  if (!Array.isArray(list)) return { status: 'error', reason: 'bad body' }
  const outage = list[0]
  if (!outage) return { status: 'clear' }
  const msg = data.customerMessage ?? {}
  if (msg.planned === true) return { status: 'clear' }
  return {
    status: 'outage',
    outageId: outage.outageId ?? null,
    startTime: outage.startTime?.iso ?? null,
    etr: msg.etr?.iso ?? null,
    etrDisplay: msg.etrOutputString ?? null
  }
}

// A 404 means "Xfinity service is not found in the provided address": no
// Xfinity there, so it is not checked. Anything else is a failed lookup.
export function neighborError(err) {
  if (err?.status === 404) return { status: 'no-service' }
  return { status: 'error', reason: err?.status ?? err?.name ?? 'error' }
}

// The building's state this run, or null when the run gives no evidence:
// a failed lookup, or no neighbor that answered. A partial or empty count
// could otherwise read as an all-clear.
export function summarizeBuilding(results, homeOutageId = null) {
  if (results.some(r => r.status === 'error')) return null
  const answered = results.filter(
    r => r.status === 'outage' || r.status === 'clear'
  )
  if (answered.length === 0) return null
  const ids = {}
  for (const r of answered) {
    if (r.status !== 'outage' || !r.outageId) continue
    ids[r.outageId] ??= {
      count: 0,
      startTime: r.startTime,
      etr: r.etr,
      etrDisplay: r.etrDisplay
    }
    ids[r.outageId].count++
  }
  return {
    checked: answered.length,
    withOutage: answered.filter(r => r.status === 'outage').length,
    sameAsHome: homeOutageId ? ids[homeOutageId]?.count ?? 0 : 0,
    ids
  }
}

// Marks a run where the home address has no unit, so the check is off.
export const BUILDING_OFF = Object.freeze({ off: true })

// The building outage being tracked after this run, or null.
// `announced` is true when a building alert went out for it, so its end is
// ours to report. When the home address lists the same outage, the home
// messages cover it from then on.
function trackBuilding(old, next) {
  const summary = next.building
  const tracked = old?.buildingOutage ?? null
  if (summary === BUILDING_OFF || summary?.off) return null
  if (!summary) return tracked // no evidence this run: nothing changes
  const homeLists = id => next.hasOutage && next.outageId === id
  // The home address listed it at the previous check: its record is
  // clearing before the neighbors' records, and "Internet is back" covers it.
  const homeListed = id => old?.hasOutage && old.outageId === id

  if (tracked && summary.ids[tracked.outageId]?.count >= 1) {
    const now = summary.ids[tracked.outageId]
    return {
      ...tracked,
      count: now.count,
      checked: summary.checked,
      etr: now.etr,
      etrDisplay: now.etrDisplay,
      announced: tracked.announced && !homeLists(tracked.outageId)
    }
  }

  let top = null
  for (const [outageId, entry] of Object.entries(summary.ids))
    if (!top || entry.count > top.count) top = { outageId, ...entry }
  if (!top || top.count < SHARED_MIN) return null
  return {
    outageId: top.outageId,
    count: top.count,
    checked: summary.checked,
    startTime: top.startTime,
    etr: top.etr,
    etrDisplay: top.etrDisplay,
    announced: !homeLists(top.outageId) && !homeListed(top.outageId)
  }
}

// Adds this run's building summary to the new state. `summary` is a summary,
// null for a run without evidence, or BUILDING_OFF.
export function attachBuilding(old, next, summary) {
  const withSummary = { ...next, building: summary ?? null }
  return { ...withSummary, buildingOutage: trackBuilding(old, withSummary) }
}

export function buildingChanges(old, next) {
  // Turned off: nothing was observed ending, so nothing is said.
  if (next.building?.off) return []
  const before = old?.buildingOutage ?? null
  const after = next.buildingOutage ?? null
  if ((before?.outageId ?? null) === (after?.outageId ?? null)) return []
  const changes = []
  if (before?.announced)
    changes.push({ type: 'building_cleared', startTime: before.startTime })
  if (after?.announced) changes.push({ type: 'building_outage' })
  return changes
}
