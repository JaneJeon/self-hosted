import { deriveWindow } from './window.mjs'

// Titles this service writes. Both are searched before any write.
export const TITLE_UNCONFIRMED = 'Codex Usage Limit Reset (Unconfirmed)'
export const TITLE_CONFIRMED = 'Codex Usage Limit Reset (Confirmed)'

// Titles an earlier workflow may have left behind. A five-month sweep of the
// Events calendar on 2026-09-08 found no title other than the two above, so
// this is empty by evidence rather than by omission. Add to it only with a
// title actually seen, because membership here licenses deletion.
export const LEGACY_TITLES = []

export const KNOWN_TITLES = [
  TITLE_UNCONFIRMED,
  TITLE_CONFIRMED,
  ...LEGACY_TITLES
]

// A watch carries no reset_type, so a banked watch can only be spotted in its
// prose. Every skip is logged so the rate stays visible: if this fires often,
// the tracker should be asked for a real field.
const BANKED_TEXT = /\bbanked\b/i

// Turn one tracker payload into the domain signal, or into a refusal.
//
// Structured evidence decides everything it can. Only the window falls back to
// prose, and that path refuses rather than guesses.
export function normalize(data, { now, logger } = {}) {
  const latestReset = data.latest_reset
    ? {
        id: data.latest_reset.id,
        resetType: data.latest_reset.reset_type,
        announcedAt: data.latest_reset.announced_at,
        sourceType: data.latest_reset.source?.type ?? null,
        sourceUrl: data.latest_reset.source?.url ?? null
      }
    : null

  const upcoming = pickUpcoming(data, { logger })
  if (!upcoming) return { latestReset, signal: null, failure: null }

  const window = deriveWindow(
    {
      scheduledFor: upcoming.scheduledFor,
      forecastWindow: upcoming.forecastWindow,
      text: upcoming.text,
      evidenceAt: upcoming.observedAt
    },
    { logger }
  )

  if (!window.ok)
    return {
      latestReset,
      signal: null,
      failure: {
        reason:
          window.reason === 'contradiction'
            ? 'contradictory_window'
            : 'unparseable_window',
        detail: window.detail,
        evidence: {
          kind: upcoming.kind,
          forecastWindow: upcoming.forecastWindow ?? null,
          text: upcoming.text ?? null,
          scheduledFor: upcoming.scheduledFor ?? null
        }
      }
    }

  return {
    latestReset,
    failure: null,
    signal: {
      kind: upcoming.kind,
      evidenceId: upcoming.evidenceId,
      // Confirmed means a person announced this, not that it has happened.
      // An active_watch is the tracker's own AI forecast, which its API
      // describes as "not an official OpenAI commitment". A scheduled_reset
      // sourced from an x_post is a human announcement. Completion is a
      // separate, later event, detected by a new latest_reset id.
      confirmed:
        upcoming.kind === 'scheduled' && upcoming.sourceType === 'x_post',
      resetType: upcoming.resetType,
      observedAt: upcoming.observedAt,
      expiresAt: upcoming.expiresAt,
      scheduledFor: upcoming.scheduledFor,
      sourceUrl: upcoming.sourceUrl,
      windowStartUtc: new Date(window.startMs).toISOString(),
      windowEndUtc: new Date(window.endMs).toISOString(),
      windowBasis: window.basis,
      windowInputs: {
        forecastWindow: upcoming.forecastWindow ?? null,
        text: upcoming.text ?? null,
        scheduledFor: upcoming.scheduledFor ?? null
      }
    },
    now
  }
}

// A human announcement outranks an AI forecast, so scheduled_reset is checked
// first and a watch is only consulted when there is no announcement.
function pickUpcoming(data, { logger } = {}) {
  const scheduled = data.scheduled_reset
  if (scheduled) {
    if (scheduled.reset_type === 'banked') {
      logger?.info(
        { id: scheduled.id, resetType: 'banked' },
        'ignoring banked scheduled reset'
      )
      return null
    }
    return {
      kind: 'scheduled',
      evidenceId: `scheduled:${scheduled.id}`,
      resetType: scheduled.reset_type,
      observedAt: scheduled.announced_at,
      expiresAt: null,
      scheduledFor: scheduled.scheduled_for,
      text: scheduled.text,
      forecastWindow: null,
      sourceType: scheduled.source?.type ?? null,
      sourceUrl: scheduled.source?.url ?? null
    }
  }

  const watch = data.active_watch
  if (!watch) return null

  // The Watch schema has no reset_type field, so this is the only signal
  // available that a forecast is about a banked credit rather than a reset.
  if (
    BANKED_TEXT.test(watch.text ?? '') ||
    BANKED_TEXT.test(watch.forecast_window ?? '')
  ) {
    logger?.info(
      { forecastWindow: watch.forecast_window ?? null },
      'ignoring watch that reads as banked'
    )
    return null
  }

  return {
    kind: 'watch',
    evidenceId: `watch:${watch.observed_at}`,
    resetType: null,
    observedAt: watch.observed_at,
    expiresAt: watch.expires_at,
    scheduledFor: null,
    text: watch.text,
    forecastWindow: watch.forecast_window,
    sourceType: watch.source?.type ?? null,
    sourceUrl: watch.source?.url ?? null
  }
}
