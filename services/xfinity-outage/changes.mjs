// Pure outage-state logic: parse the API response, compare two states, and word
// the notification. Kept separate from monitor.mjs so tests can import it
// without running a real monitor pass (the same reason retry.mjs is separate).

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

// Xfinity's restore estimate as words, or null when Xfinity gives none.
function etrText(state) {
  if (state.etrDisplay) return state.etrDisplay
  if (state.etr) return formatTime(state.etr)
  return null
}

// A missing estimate is not a time, so it is never "earlier" or "later" than
// one. Comparing them as dates (null as epoch 0) once reported a dropped
// estimate as "ETA moved up → null. Internet still down", fifteen minutes
// after service had come back (2026-10-19, see README).
function compareEtr(old, next) {
  if (old.etr === next.etr) return null
  if (old.etr && next.etr) {
    const diff = new Date(next.etr) - new Date(old.etr)
    if (diff === 0) return null
    return {
      type: diff > 0 ? 'etr_pushed' : 'etr_earlier',
      oldEtr: etrText(old),
      newEtr: etrText(next)
    }
  }
  if (next.etr) return { type: 'etr_set', newEtr: etrText(next) }
  return { type: 'etr_cleared', oldEtr: etrText(old) }
}

export function detectChanges(old, next) {
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
  if (old.outageType !== next.outageType) {
    changes.push({
      type: 'type_changed',
      oldType: old.outageType,
      newType: next.outageType
    })
  }
  return changes
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

// Returns '' when no change is worth a notification.
export function buildMessage(changes, state) {
  const parts = []
  const svc = (state.services ?? ['Internet']).join(', ')
  const etr = etrText(state)
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
              : `Xfinity has not given a restore time yet.`)
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
            `Xfinity no longer lists the maintenance scheduled for ${started}.`
        )
      } else {
        // The monitor only sees Xfinity's record, at 15-minute checks, so it
        // reports when the record cleared rather than a downtime it cannot
        // measure. Xfinity can lag the real repair (see README).
        const window = c.lastListedAt
          ? ` It was still listed at ${formatTime(c.lastListedAt)}` +
            ` and gone by ${formatTime(c.goneAt)}.`
          : ''
        parts.push(
          `<b>Xfinity: Internet is back</b>\n\n` +
            `Xfinity has cleared the outage that started at ${started}.${window}`
        )
      }
    } else if (c.type === 'etr_set') {
      const since = formatTime(state.startTime)
      const label = state.planned ? ' (planned maintenance)' : ''
      parts.push(
        `<b>Xfinity: Outage ETA posted</b>\n\n` +
          `Xfinity now estimates restoration by ${c.newEtr}.\n` +
          `Internet still down since ${since}${label}.`
      )
    } else if (c.type === 'etr_pushed') {
      const since = formatTime(state.startTime)
      const label = state.planned ? ' (planned maintenance)' : ''
      parts.push(
        `<b>Xfinity: Outage ETA pushed back</b>\n\n` +
          `Estimated restore changed: ${c.oldEtr} → ${c.newEtr}.\n` +
          `Internet still down since ${since}${label}.`
      )
    } else if (c.type === 'etr_earlier') {
      const since = formatTime(state.startTime)
      const label = state.planned ? ' (planned maintenance)' : ''
      parts.push(
        `<b>Xfinity: Outage ETA moved up</b>\n\n` +
          `Estimated restore changed: ${c.oldEtr} → ${c.newEtr}.\n` +
          `Internet still down since ${since}${label}.`
      )
    } else if (c.type === 'type_changed') {
      const since = formatTime(state.startTime)
      parts.push(
        `<b>Xfinity: Outage reclassified</b>\n\n` +
          `Previously reported as ${c.oldType}, now listed as ${c.newType}.\n` +
          `Internet still down since ${since}.` +
          (etr ? ` ETA: ${etr}.` : '')
      )
    }
    // etr_cleared is deliberately silent. The one observed instance was the
    // last check before Xfinity cleared the outage, after service was already
    // back, so a message there says nothing true and useful. The change is
    // still logged, and the resolution message follows when the outage clears.
  }

  return parts.join('\n\n')
}
