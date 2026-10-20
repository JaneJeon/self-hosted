// Building-wide outage check. Xfinity attaches the same outage ID to every
// affected unit, so other apartments in the building show whether an outage
// is shared or only at the home address. Pure functions: monitor.mjs does the
// fetching, changes.mjs words the messages. Evidence: the Craft note in README.

// Neighbors checked per run, at one extra status call each.
export const MAX_NEIGHBORS = 6
// Neighbors on one outage ID before it counts as building-wide. One unit
// alone may be that unit's own problem.
export const SHARED_MIN = 2

function words(address) {
  return decodeURIComponent(String(address ?? '').replace(/\+/g, ' '))
    .trim()
    .split(/\s+/)
}

function unitIndex(ws) {
  return ws.findIndex(w => /^(apt|unit|#)$/i.test(w))
}

// "250+Main+St+Apt+123+Springfield+CA+94000" becomes
// "250 Main St Apt Springfield CA 94000", the typeahead query for the
// building. Null when the address has no unit, which turns the check off.
export function buildingQuery(homeAddress) {
  const ws = words(homeAddress)
  const i = unitIndex(ws)
  if (i < 0 || i + 1 >= ws.length) return null
  return [...ws.slice(0, i + 1), ...ws.slice(i + 2)].join(' ')
}

// "250 MAIN ST" for "250+Main+St+Apt+123+...", so neighbors from another
// building on the same street are never counted.
function streetPrefix(address) {
  const ws = words(address)
  const i = unitIndex(ws)
  return (i < 0 ? ws : ws.slice(0, i)).join(' ').toUpperCase()
}

// The unit of a residential apartment, "APT 816" giving "816". Null for
// anything else, such as "UNIT HMOFC" or "APT 710-HMOFC": those read as
// business lines, which may not share residential service.
export function residentialUnit(address) {
  const m = /\bAPT\s+(\d[0-9A-Z]*)(?=\s|$)/i.exec(words(address).join(' '))
  return m ? m[1].toUpperCase() : null
}

// Up to `max` residential neighbors from a typeahead response: same street
// address, APT units only, the home unit and duplicates left out.
export function pickNeighbors(typeahead, homeAddress, max = MAX_NEIGHBORS) {
  const home = residentialUnit(homeAddress)
  const street = streetPrefix(homeAddress)
  const seen = new Set()
  const picked = []
  for (const entry of typeahead?.addresses ?? []) {
    const full = entry?.fullStreetAddress
    const unit = residentialUnit(full)
    if (!unit || unit === home || seen.has(unit)) continue
    if (
      !String(full)
        .toUpperCase()
        .startsWith(street + ' ')
    )
      continue
    seen.add(unit)
    picked.push(full)
    if (picked.length >= max) break
  }
  return picked
}

// One neighbor's status call, reduced to what the comparison needs.
export function neighborResult(data) {
  const outage = (data?.outageInfoResponseList ?? [])[0]
  if (!outage) return { status: 'clear' }
  const msg = data.customerMessage ?? {}
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
  return { status: err?.status === 404 ? 'no-service' : 'error' }
}

// Null when any lookup failed. A partial count could fall below SHARED_MIN
// and report a building outage cleared when it was not, so a run with a
// failure makes no building decision and the previous one stands.
export function summarizeBuilding(results, homeOutageId = null) {
  if (results.some(r => r.status === 'error')) return null
  const answered = results.filter(
    r => r.status === 'outage' || r.status === 'clear'
  )
  const byId = new Map()
  for (const r of answered) {
    if (r.status !== 'outage' || !r.outageId) continue
    const entry = byId.get(r.outageId) ?? { ...r, count: 0 }
    entry.count++
    byId.set(r.outageId, entry)
  }
  let top = null
  for (const entry of byId.values())
    if (!top || entry.count > top.count) top = entry
  const shared = top && top.count >= SHARED_MIN ? top : null
  return {
    checked: answered.length,
    withOutage: answered.filter(r => r.status === 'outage').length,
    sameAsHome: homeOutageId ? byId.get(homeOutageId)?.count ?? 0 : 0,
    sharedId: shared?.outageId ?? null,
    sharedCount: shared?.count ?? 0,
    startTime: shared?.startTime ?? null,
    etr: shared?.etr ?? null,
    etrDisplay: shared?.etrDisplay ?? null
  }
}

// The building outage worth its own alert: shared by neighbors while the home
// address lists nothing. When the home address lists an outage, the home
// messages carry the neighbor count instead.
function buildingOnly(old, next) {
  if (next.hasOutage) return null
  if (!next.building) return old?.buildingOnly ?? null
  const b = next.building
  if (!b.sharedId) return null
  return {
    outageId: b.sharedId,
    count: b.sharedCount,
    checked: b.checked,
    startTime: b.startTime,
    etr: b.etr,
    etrDisplay: b.etrDisplay
  }
}

// Adds this run's building summary to the new state. `summary` is null when
// the check failed or is off, and then the previous building outage stands.
export function attachBuilding(old, next, summary) {
  const withSummary = { ...next, building: summary ?? null }
  return { ...withSummary, buildingOnly: buildingOnly(old, withSummary) }
}

export function buildingChanges(old, next) {
  const before = old?.buildingOnly ?? null
  const after = next.buildingOnly ?? null
  if ((before?.outageId ?? null) === (after?.outageId ?? null)) return []
  if (after) return [{ type: 'building_outage' }]
  // The home address now lists an outage, which its own message reports,
  // or the check failed and nothing is known.
  if (next.hasOutage || !next.building) return []
  return [{ type: 'building_cleared', startTime: before.startTime }]
}
