// Pure outage-state logic: parse the API response, compare two states, and word
// the notification. Kept separate from monitor.mjs so tests can import it
// without running a real monitor pass (the same reason retry.mjs is separate).

import { buildingChanges, isNotice } from './building.mjs'

function textOf(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// A notice's words are quoted in messages and kept in state. An outage's text
// names the street, so in case a notice ever does, the home street (`street`,
// from HOME_ADDRESS) is replaced, whatever its case or spacing.
function maskStreet(text, street) {
  const words = textOf(street)?.split(/\s+/)
  if (text == null || !words) return text
  const pattern = words
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  return String(text).replace(new RegExp(pattern, 'gi'), 'your address')
}

export function extractState(data, now = new Date(), street = null) {
  const outages = data.outageInfoResponseList ?? []
  const msg = data.customerMessage ?? null

  if (!outages.length || !msg) {
    return {
      hasOutage: false,
      notice: false,
      outageId: null,
      outageType: null,
      planned: null,
      services: null,
      startTime: null,
      etr: null,
      etrDisplay: null,
      shortDescription: null,
      noticeText: null,
      impactStyle: null,
      customerFacingText: null,
      checkedAt: now.toISOString()
    }
  }

  const outage = outages[0]
  const notice = isNotice(msg)
  return {
    hasOutage: true,
    notice,
    outageId: outage.outageId,
    outageType: msg.outageType ?? null,
    planned: msg.planned ?? false,
    services: outage.services ?? [],
    startTime: outage.startTime?.iso ?? null,
    etr: msg.etr?.iso ?? null,
    etrDisplay: msg.etrOutputString ?? null,
    shortDescription: notice
      ? maskStreet(msg.messages?.shortDescription ?? null, street)
      : msg.messages?.shortDescription ?? null,
    // Kept only for a notice: an outage's detailedDescription names the
    // street address.
    noticeText: notice
      ? maskStreet(textOf(msg.messages?.detailedDescription), street)
      : null,
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
  // Xfinity's display string, when it is one, or else the date.
  if (typeof state.etrDisplay === 'string' && state.etrDisplay.trim())
    return state.etrDisplay
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

// Whether a start time had passed by a check. Only a start that had passed
// was reported as the start; one still ahead is maintenance scheduled.
function startedBy(iso, at) {
  const start = readableTime(iso)
  const check = readableTime(at)
  return start !== null && check !== null && start <= check
}

// Maintenance listed with a start still ahead of the check.
function upcoming(state) {
  const start = readableTime(state.startTime)
  const check = readableTime(state.checkedAt)
  return (
    Boolean(state.planned) && start !== null && check !== null && start > check
  )
}

// What the home address lists: nothing, an outage, or a notice. State saved
// before notices were recognized has no `notice` field, only the type.
function kindOf(state) {
  if (!state?.hasOutage) return 'none'
  const notice = state.notice ?? isNotice({ outageType: state.outageType })
  return notice ? 'notice' : 'outage'
}

// Whether a home outage is on: an outage listed and not merely scheduled, or
// a notice that replaced one. Its start and end are the Slack pair and the
// "Internet is down" / "Internet is back" ends.
function isOn(state) {
  const kind = kindOf(state)
  if (kind === 'notice') return Boolean(state.followsOutage)
  return kind === 'outage' && !upcoming(state)
}

// Xfinity can move an outage's start while it lasts: on 2026-10-20 the
// outage first reported as starting at 7:32 AM later listed 10:32 AM, and the
// all-clear named 10:32. `reportedStart` keeps the start the alerts gave, for
// as long as the same outage is listed, a notice in between included. A start
// still ahead is not kept, so rescheduled maintenance follows Xfinity. State
// saved without it falls back to its start time.
//
// A notice that replaces an outage carries it in `followsOutage`, so the
// all-clear waits until Xfinity lists nothing at all. On 2026-10-20 the notice
// that replaced the outage warned of brief interruptions, so it did not say
// the internet was back.
export function carryOver(old, next) {
  const before = kindOf(old)
  const after = kindOf(next)
  if (after === 'outage') {
    const prior =
      before === 'outage' && old.outageId === next.outageId
        ? { start: old.reportedStart ?? old.startTime, at: old.checkedAt }
        : before === 'notice' && old.followsOutage?.outageId === next.outageId
        ? { start: old.followsOutage.reportedStart, at: old.followsOutage.at }
        : null
    const reportedStart =
      prior && startedBy(prior.start, prior.at) ? prior.start : next.startTime
    return { ...next, reportedStart, followsOutage: null }
  }
  if (after === 'notice') {
    const followsOutage =
      before === 'outage' && isOn(old)
        ? {
            outageId: old.outageId,
            startTime: old.startTime,
            reportedStart: startOf(old),
            planned: old.planned ?? false,
            at: old.checkedAt
          }
        : before === 'notice'
        ? old.followsOutage ?? null
        : null
    return { ...next, reportedStart: null, followsOutage }
  }
  return { ...next, reportedStart: null, followsOutage: null }
}

// The start time messages name: the first one reported.
function startOf(state) {
  return state.reportedStart ?? state.startTime
}

// The all-clear for an outage that was on in `old`, or for maintenance that
// never started.
function clearedFrom(old, next) {
  const after = kindOf(old) === 'notice' ? old.followsOutage : null
  return {
    type: 'resolved',
    startTime: after ? after.startTime ?? null : old.startTime,
    reportedStart: after
      ? after.reportedStart ?? after.startTime ?? null
      : startOf(old),
    planned: after ? after.planned ?? false : old.planned,
    lastListedAt: old.checkedAt ?? null,
    goneAt: next.checkedAt,
    notice: after ? { title: old.shortDescription } : null
  }
}

function homeChanges(old, next) {
  const before = kindOf(old)
  const after = kindOf(next)

  if (after === 'notice') {
    if (before === 'outage') {
      // Not an outage, and not the all-clear either: Xfinity says work nearby
      // may still interrupt service. The old code called this "reclassified,
      // Internet still down".
      if (isOn(old))
        return [
          {
            type: 'outage_to_notice',
            startTime: old.startTime,
            reportedStart: startOf(old),
            lastListedAt: old.checkedAt ?? null
          }
        ]
      // Maintenance that never started is gone, and the notice is news.
      return [clearedFrom(old, next), { type: 'notice_posted' }]
    }
    if (before === 'none' || old.outageId !== next.outageId)
      return [{ type: 'notice_posted' }]
    return []
  }
  if (after === 'none') {
    // An outage, or a notice that replaced one, is gone: the all-clear.
    if (before === 'outage' || (before === 'notice' && old.followsOutage))
      return [clearedFrom(old, next)]
    if (before === 'notice') return [{ type: 'notice_cleared' }]
    return []
  }
  if (before !== 'outage' || old.outageId !== next.outageId)
    return [{ type: 'new_outage' }]

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

// The all-clear's sentence, for Telegram and Slack alike. The monitor only
// sees Xfinity's record, at 15-minute checks, so it says when the record
// cleared rather than a downtime it cannot measure. When a notice followed
// the outage, the record cleared when the notice went.
function clearedSentence(c) {
  const start = readableClock(c.reportedStart ?? c.startTime)
  const which = start ? `the outage that started at ${start}` : 'the outage'
  const title = textOf(c.notice?.title)
  const after = !c.notice
    ? ''
    : title
    ? ` and the "${esc(title)}" notice after it`
    : ' and the notice after it'
  const subject = c.notice ? 'The notice' : 'It'
  const window = c.lastListedAt
    ? ` ${subject} was still listed at ${formatTime(c.lastListedAt)}` +
      ` and gone by ${formatTime(c.goneAt)}.`
    : ''
  return `Xfinity has cleared ${which}${after}.${window}`
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

// The services an outage lists, or "Internet" when it lists none.
function servicesOf(state) {
  const list = Array.isArray(state.services)
    ? state.services.filter(x => textOf(x))
    : []
  return esc((list.length ? list : ['Internet']).join(', '))
}

// Returns '' when no change is worth a notification.
export function buildMessage(changes, state) {
  const parts = []
  const svc = servicesOf(state)
  const etr = esc(etrText(state))

  for (const c of changes) {
    if (c.type === 'new_outage') {
      const ahead = upcoming(state)
      const since = formatTime(ahead ? state.startTime : startOf(state))
      if (ahead) {
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
        parts.push(`<b>Xfinity: Internet is back</b>\n\n${clearedSentence(c)}`)
      }
    } else if (c.type === 'outage_to_notice') {
      const title = textOf(state.shortDescription)
      const body = textOf(state.noticeText)
      const start = readableClock(c.reportedStart ?? c.startTime)
      const which = start ? `the outage that started at ${start}` : 'the outage'
      const by = c.lastListedAt
        ? ` It was still listed at ${formatTime(c.lastListedAt)}, and by ` +
          `${formatTime(state.checkedAt)} Xfinity showed`
        : ` By ${formatTime(state.checkedAt)} Xfinity showed`
      parts.push(
        `<b>Xfinity: ${esc(title ?? 'Notice for your address')}</b>\n\n` +
          `Xfinity no longer lists ${which}.${by} this notice instead` +
          (body ? `:\n${esc(body)}` : ', with no text.')
      )
    } else if (c.type === 'notice_posted') {
      const title = textOf(state.shortDescription)
      const body = textOf(state.noticeText)
      parts.push(
        `<b>Xfinity: ${esc(title ?? 'Notice for your address')}</b>\n\n` +
          (body ? `${esc(body)}\n` : '') +
          `Xfinity lists this as a notice, not an outage.`
      )
    } else if (c.type === 'etr_set') {
      const since = formatTime(startOf(state))
      const label = state.planned ? ' (planned maintenance)' : ''
      parts.push(
        `<b>Xfinity: Outage ETA posted</b>\n\n` +
          `Xfinity now estimates restoration by ${esc(c.newEtr)}.\n` +
          `Internet still down since ${since}${label}.`
      )
    } else if (c.type === 'etr_pushed') {
      const since = formatTime(startOf(state))
      const label = state.planned ? ' (planned maintenance)' : ''
      parts.push(
        `<b>Xfinity: Outage ETA pushed back</b>\n\n` +
          `Estimated restore changed: ${esc(c.oldEtr)} → ${esc(c.newEtr)}.\n` +
          `Internet still down since ${since}${label}.`
      )
    } else if (c.type === 'etr_earlier') {
      const since = formatTime(startOf(state))
      const label = state.planned ? ' (planned maintenance)' : ''
      parts.push(
        `<b>Xfinity: Outage ETA moved up</b>\n\n` +
          `Estimated restore changed: ${esc(c.oldEtr)} → ${esc(c.newEtr)}.\n` +
          `Internet still down since ${since}${label}.`
      )
    } else if (c.type === 'type_changed') {
      const since = formatTime(startOf(state))
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
    // notice_cleared is silent too: a notice going away asks nothing of you.
    // A notice that followed an outage ends in the all-clear instead.
  }

  return parts.join('\n\n')
}

// The Slack post for #infra-homeassistant-incidents, where PagerDuty posts
// Home Assistant's incidents: one when a home outage comes on and one when it
// goes off, with the Telegram titles, so the alerts in between read as this
// outage. It follows isOn rather than the Telegram messages, so the two
// always pair: a notice replacing the outage, a new outage ID while one is on,
// estimate changes and building news post nothing, and maintenance posts
// when its start passes. Slack mrkdwn needs &, < and > escaped, which esc
// does; *, _ and ~ in Xfinity's text still format. Returns '' when there is
// nothing to post.
export function buildSlack(old, next) {
  const was = isOn(old)
  const now = isOn(next)
  if (!was && now) {
    const etr = esc(etrText(next))
    const since = readableClock(startOf(next))
    const what = next.planned ? 'Planned maintenance' : 'An unplanned outage'
    const building = next.planned ? '' : neighborLine(next.building).trim()
    return (
      `:red_circle: *Xfinity: Internet is down${
        next.planned ? ' (planned maintenance)' : ''
      }*\n` +
      (since
        ? `${what} started at ${since}, affecting ${servicesOf(next)}. `
        : `${what} is affecting ${servicesOf(next)}. `) +
      (etr
        ? `Xfinity estimates restoration by ${etr}.`
        : `Xfinity has not given a restore time yet.`) +
      (building ? ` ${building}` : '')
    )
  }
  if (was && !now)
    return `:large_green_circle: *Xfinity: Internet is back*\n${clearedSentence(
      clearedFrom(old, next)
    )}`
  return ''
}
