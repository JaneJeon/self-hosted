import { httpError } from './retry.mjs'

// https://codex-resets.com/api/docs — read-only, unauthenticated.
export const TRACKER_URL = 'https://codex-resets.com/api/v1/status'

// The tracker sits behind Cloudflare and answers in well under a second when
// healthy. This only exists so a stalled upstream cannot hold the cron run
// open. Retry policy lives in retry.mjs.
const HTTP_TIMEOUT_MS = 15_000

// A hostile or mistaken Retry-After must not park the run past its own cron
// interval, so the honoured value is capped.
const MAX_RETRY_AFTER_MS = 60_000

const USER_AGENT =
  'codex-reset-watch (+https://github.com/JaneJeon/self-hosted)'

// Fetch the current status, conditionally.
//
// A 304 is a success, not an error: it means nothing has changed since the
// stored ETag, which is the common case at a two-hour cadence and is the
// cheapest possible no-op.
export async function fetchStatus({ etag, baseUrl = TRACKER_URL } = {}) {
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT }
  if (etag) headers['If-None-Match'] = etag

  const resp = await fetch(baseUrl, {
    headers,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
  })

  if (resp.status === 304) return { notModified: true }

  if (resp.status === 429) {
    const after = Number(resp.headers.get('Retry-After'))
    const waitMs = Number.isFinite(after)
      ? Math.min(after * 1000, MAX_RETRY_AFTER_MS)
      : null
    const err = httpError('Tracker API returned HTTP 429', 429)
    err.retryAfterMs = waitMs
    // Rate limiting is transient by nature, so let withRetry handle it even
    // though 429 is a 4xx and the default predicate would refuse.
    err.transient = true
    throw err
  }

  if (!resp.ok)
    throw httpError(`Tracker API returned HTTP ${resp.status}`, resp.status)

  const body = await resp.json()
  assertShape(body)
  return {
    notModified: false,
    etag: resp.headers.get('ETag'),
    data: body.data,
    generatedAt: body.meta.generated_at
  }
}

// Fail loudly on contract drift rather than quietly treating a renamed field
// as an absent one. An absent signal and a signal we can no longer read look
// identical downstream, and one of them means the calendar gets cleared.
function assertShape(body) {
  if (!body || typeof body !== 'object' || !body.data || !body.meta)
    throw new Error('Tracker response is missing data or meta')
  if (body.meta.api_version !== 'v1')
    throw new Error(
      `Tracker API version changed: expected v1, got ${body.meta.api_version}`
    )
  for (const key of [
    'latest_reset',
    'scheduled_reset',
    'active_watch',
    'stats'
  ])
    if (!(key in body.data))
      throw new Error(`Tracker response is missing data.${key}`)
}

// A 429 carries its own transient flag; everything else follows retry.mjs.
export function isTransientTrackerError(err) {
  if (err.transient) return true
  return err.status === undefined || err.status >= 500
}
