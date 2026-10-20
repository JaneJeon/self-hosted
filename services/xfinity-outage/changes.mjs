// Pure outage-state logic: parse the API response, compare two states, and word
// the notification. Kept separate from monitor.mjs so tests can import it
// without running a real monitor pass (the same reason retry.mjs is separate).

export function extractState(data) {
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
      checkedAt: new Date().toISOString()
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
    checkedAt: new Date().toISOString()
  }
}

export function detectChanges(old, next) {
  if (!old) return next.hasOutage ? [{ type: 'new_outage' }] : []
  if (!old.hasOutage && next.hasOutage) return [{ type: 'new_outage' }]
  if (old.hasOutage && !next.hasOutage)
    return [{ type: 'resolved', startTime: old.startTime }]
  if (old.outageId !== next.outageId) return [{ type: 'new_outage' }]

  const changes = []
  if (old.etr !== next.etr) {
    const pushed = new Date(next.etr ?? 0) > new Date(old.etr ?? 0)
    changes.push({
      type: pushed ? 'etr_pushed' : 'etr_earlier',
      oldEtr: old.etrDisplay ?? old.etr,
      newEtr: next.etrDisplay ?? next.etr
    })
  }
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
function formatTime(isoString) {
  if (!isoString) return 'unknown time'
  return new Date(isoString).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  })
}

function timeSince(isoString) {
  const mins = Math.round((Date.now() - new Date(isoString).getTime()) / 60_000)
  if (mins < 60) return `~${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `~${h}h ${m}m` : `~${h}h`
}

export function buildMessage(changes, state) {
  const parts = []

  for (const c of changes) {
    const svc = (state.services ?? ['Internet']).join(', ')
    const etr = state.etrDisplay ?? formatTime(state.etr)

    if (c.type === 'new_outage') {
      const since = formatTime(state.startTime)
      const upcoming =
        state.startTime && new Date(state.startTime).getTime() > Date.now()
      if (state.planned && upcoming) {
        parts.push(
          `<b>Xfinity: Planned maintenance scheduled</b>\n\n` +
            `Xfinity has scheduled maintenance that may affect your ${svc} service.\n` +
            `Window: ${since} – ${etr}.`
        )
      } else if (state.planned) {
        parts.push(
          `<b>Xfinity: Internet is down (planned maintenance)</b>\n\n` +
            `Your internet went down at ${since}.\n` +
            `Xfinity is doing scheduled network maintenance and expects to restore service by ${etr}.`
        )
      } else {
        parts.push(
          `<b>Xfinity: Internet is down</b>\n\n` +
            `An unplanned outage started at ${since} affecting ${svc} service.\n` +
            `Xfinity estimates restoration by ${etr}.`
        )
      }
    } else if (c.type === 'resolved') {
      const downtime = c.startTime ? timeSince(c.startTime) : null
      parts.push(
        `<b>Xfinity: Internet is back</b>\n\n` +
          `The outage has been resolved.` +
          (downtime ? ` Total downtime: ${downtime}.` : '')
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
          `Internet still down since ${since}. ETA: ${etr}.`
      )
    }
  }

  return parts.join('\n\n')
}
