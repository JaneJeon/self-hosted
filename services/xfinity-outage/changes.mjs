// Pure outage-state logic: parse the API response, compare two states, and word
// the notification. Kept separate from monitor.mjs so tests can import it
// without running a real monitor pass (the same reason retry.mjs is separate).

import { buildingChanges } from './building.mjs'

export function extractState(data, now = new Date()) {
  const outages = data.outageInfoResponseList ?? []
  const msg = data.customerMessage ?? null

  if (!outages.length || !msg) {
    return {
      hasOutage: false,
      outageId: null,
      outageType: null,
      planned: null,
      services: null,
      startTime: null,
      etr: null,
      etrDisplay: null,
      shortDescription: null,
      impactStyle: null,
      customerFacingText: null,
      checkedAt: now.toISOString()
    }
  }

  const outage = outages[0]
  return {
    hasOutage: true,
    outageId: outage.outageId,
    outageType: msg.outageType ?? null,
    planned: msg.planned ?? false,
    services: outage.services ?? [],
    startTime: outage.startTime?.iso ?? null,
    etr: msg.etr?.iso ?? null,
    etrDisplay: msg.etrOutputString ?? null,
    shortDescription: msg.messages?.shortDescription ?? null,
    impactStyle: msg.impactStyle ?? null,
    customerFacingText: msg.customerFacingText ?? null,
    checkedAt: now.toISOString()
  }
}

// Milliseconds for a timestamp, or null when it is missing or unreadable.
// Anything that is not a readable time is treated as no estimate at all.
function readableTime(iso) {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? null : ms
}

// Xfinity's restore estimate as words, or null when Xfinity gives none.
function etrText(state) {
  if (state.etrDisplay) return state.etrDisplay
  if (readableTime(state.etr) !== null) return formatDateTime(state.etr)
  return null
}

// A missing estimate is not a time, so it is never "earlier" or "later" than
// one. Comparing them as dates (null as epoch 0) once reported a dropped
// estimate as "ETA moved up → null. Internet still down".
function compareEtr(old, next) {
  const before = readableTime(old.etr)
  const after = readableTime(next.etr)
  if (before === after) return null
  if (before !== null && after !== null)
    return {
      type: after > before ? 'etr_pushed' : 'etr_earlier',
      oldEtr: etrText(old),
      newEtr: etrText(next)
    }
  if (after !== null) return { type: 'etr_set', newEtr: etrText(next) }
  return { type: 'etr_cleared', oldEtr: etrText(old) }
}

// Same rule for the outage type: a type that disappears while the outage is
// still listed is not a new type, and printing it would read "now listed as
// null. Internet still down".
function compareType(old, next) {
  if (old.outageType === next.outageType) return null
  if (!next.outageType) return { type: 'type_cleared', oldType: old.outageType }
  return {
    type: 'type_changed',
    oldType: old.outageType ?? null,
    newType: next.outageType
  }
}

function homeChanges(old, next) {
  if (!old) return next.hasOutage ? [{ type: 'new_outage' }] : []
  if (!old.hasOutage && next.hasOutage) return [{ type: 'new_outage' }]
  if (old.hasOutage && !next.hasOutage)
    return [
      {
        type: 'resolved',
        startTime: old.startTime,
        planned: old.planned,
        lastListedAt: old.checkedAt ?? null,
        goneAt: next.checkedAt
      }
    ]
  if (old.outageId !== next.outageId) return [{ type: 'new_outage' }]

  const changes = []
  const etrChange = compareEtr(old, next)
  if (etrChange) changes.push(etrChange)
  const typeChange = compareType(old, next)
  if (typeChange) changes.push(typeChange)
  return changes
}

export function detectChanges(old, next) {
  return [...homeChanges(old, next), ...buildingChanges(old, next)]
}

// One line on the other apartments checked, for the unplanned home outage
// message. Empty when the check is off or gave no evidence this run.
function neighborLine(building) {
  if (!building || building.off || !building.checked) return ''
  const n = building.checked
  const others = n === 1 ? 'other apartment' : 'other apartments'
  if (building.sameAsHome > 0)
    return `\nSame outage at ${building.sameAsHome} of ${n} ${others} checked in your building.`
  const different = building.withOutage
    ? ` (${building.withOutage} ${
        building.withOutage === 1 ? 'lists' : 'list'
      } a different outage)`
    : ''
  return `\nNot listed at the ${n} ${others} checked in your building${different}, so it may be only your line.`
}

// Telegram parses these messages as HTML, so text from Xfinity must not be
// able to open a tag. A stray "<" or "&" once meant a 400 and a failed run.
function esc(text) {
  if (text == null) return text
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// A clock time, or null when the timestamp is missing or unreadable.
function readableClock(iso) {
  return readableTime(iso) === null ? null : formatTime(iso)
}

// Displays time in Pacific — this service monitors a California address.
export function formatTime(isoString) {
  if (!isoString) return 'unknown time'
  return new Date(isoString).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  })
}

// With the date, for times that can be days away: an estimate without
// Xfinity's own display string, or maintenance scheduled ahead. Without it, an
// estimate moved by a whole day read "12:10 AM PDT → 12:10 AM PDT".
function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  })
}

// Returns '' when no change is worth a notification.
export function buildMessage(changes, state) {
  const parts = []
  const svc = esc((state.services ?? ['Internet']).join(', '))
  const etr = esc(etrText(state))
  const now = new Date(state.checkedAt ?? Date.now())

  for (const c of changes) {
    if (c.type === 'new_outage') {
      const since = formatTime(state.startTime)
      const upcoming =
        state.startTime && new Date(state.startTime).getTime() > now.getTime()
      if (state.planned && upcoming) {
        parts.push(
          `<b>Xfinity: Planned maintenance scheduled</b>\n\n` +
            `Xfinity has scheduled maintenance that may affect your ${svc} service.\n` +
            (etr
              ? `Window: ${since} – ${etr}.`
              : `Starts ${since}. Xfinity has not given an end time.`)
        )
      } else if (state.planned) {
        parts.push(
          `<b>Xfinity: Internet is down (planned maintenance)</b>\n\n` +
            `Your internet went down at ${since}.\n` +
            (etr
              ? `Xfinity is doing scheduled network maintenance and expects to restore service by ${etr}.`
              : `Xfinity is doing scheduled network maintenance and has not given a restore time.`)
        )
      } else {
        parts.push(
          `<b>Xfinity: Internet is down</b>\n\n` +
            `An unplanned outage started at ${since} affecting ${svc} service.\n` +
            (etr
              ? `Xfinity estimates restoration by ${etr}.`
              : `Xfinity has not given a restore time yet.`) +
            neighborLine(state.building)
        )
      }
    } else if (c.type === 'resolved') {
      const started = formatTime(c.startTime)
      const scheduledAhead =
        c.planned &&
        c.startTime &&
        new Date(c.startTime).getTime() > new Date(c.goneAt).getTime()
      if (scheduledAhead) {
        // It never started, so there is no downtime to report. Measuring
        // "downtime" from a future start time once printed ~-4004m.
        parts.push(
          `<b>Xfinity: Planned maintenance removed</b>\n\n` +
            `Xfinity no longer lists the maintenance scheduled for ${formatDateTime(
              c.startTime
            )}.`
        )
      } else {
        // The monitor only sees Xfinity's record, at 15-minute checks, so it
        // reports when the record cleared rather than a downtime it cannot
        // measure.
        const which = c.startTime
          ? `the outage that started at ${started}`
          : 'the outage'
        const window = c.lastListedAt
          ? ` It was still listed at ${formatTime(c.lastListedAt)}` +
            ` and gone by ${formatTime(c.goneAt)}.`
          : ''
        parts.push(
          `<b>Xfinity: Internet is back</b>\n\n` +
            `Xfinity has cleared ${which}.${window}`
        )
      }
    } else if (c.type === 'etr_set') {
      const since = formatTime(state.startTime)
      const label = state.planned ? ' (planned maintenance)' : ''
      parts.push(
        `<b>Xfinity: Outage ETA posted</b>\n\n` +
          `Xfinity now estimates restoration by ${esc(c.newEtr)}.\n` +
          `Internet still down since ${since}${label}.`
      )
    } else if (c.type === 'etr_pushed') {
      const since = formatTime(state.startTime)
      const label = state.planned ? ' (planned maintenance)' : ''
      parts.push(
        `<b>Xfinity: Outage ETA pushed back</b>\n\n` +
          `Estimated restore changed: ${esc(c.oldEtr)} → ${esc(c.newEtr)}.\n` +
          `Internet still down since ${since}${label}.`
      )
    } else if (c.type === 'etr_earlier') {
      const since = formatTime(state.startTime)
      const label = state.planned ? ' (planned maintenance)' : ''
      parts.push(
        `<b>Xfinity: Outage ETA moved up</b>\n\n` +
          `Estimated restore changed: ${esc(c.oldEtr)} → ${esc(c.newEtr)}.\n` +
          `Internet still down since ${since}${label}.`
      )
    } else if (c.type === 'type_changed') {
      const since = formatTime(state.startTime)
      const was = c.oldType
        ? `Previously reported as ${esc(c.oldType)}, now listed as ${esc(
            c.newType
          )}.`
        : `Xfinity now lists it as ${esc(c.newType)}.`
      parts.push(
        `<b>Xfinity: Outage reclassified</b>\n\n` +
          `${was}\n` +
          `Internet still down since ${since}.` +
          (etr ? ` ETA: ${etr}.` : '')
      )
    } else if (c.type === 'building_outage') {
      const b = c
      const started = readableClock(b.startTime)
      const since = started ? `, started at ${started}` : ''
      const restore = esc(etrText(b))
      parts.push(
        `<b>Xfinity: Outage in your building</b>\n\n` +
          `Xfinity lists an outage at ${b.count} of ${b.checked} other apartments checked in your building${since}. ` +
          `It is not listed at your address.` +
          (restore ? `\nXfinity estimates restoration by ${restore}.` : '')
      )
    } else if (c.type === 'building_cleared') {
      const started = readableClock(c.startTime)
      const since = started ? ` that started at ${started}` : ''
      parts.push(
        `<b>Xfinity: Building outage cleared</b>\n\n` +
          `Xfinity no longer lists the outage${since} at the other apartments checked in your building.`
      )
    }
    // etr_cleared and type_cleared are deliberately silent: the one observed
    // dropped estimate came just before the outage cleared, after service was
    // back. They are still logged, and the all-clear follows when the outage
    // clears. Evidence and the open question: the Craft note in README.
  }

  return parts.join('\n\n')
}
