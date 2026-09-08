import { httpError, withRetry } from './retry.mjs'

const HTTP_TIMEOUT_MS = 15_000
const ZONE = 'America/Los_Angeles'

// Messages read like a person wrote them, in the reader's own timezone.
// Formatting matches xfinity-outage: a bold title, a blank line, then prose.
function when(iso) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: ZONE,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  })
}

function timeOnly(iso) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

function windowText(signal) {
  return `${when(signal.windowStartUtc)} to ${timeOnly(signal.windowEndUtc)}`
}

// A source line is only added when there is a URL to add. The observed source
// variant makes it optional, and a link to nothing is worse than no link.
function source(signal) {
  return signal?.sourceUrl ? `\n\n${signal.sourceUrl}` : ''
}

export function buildMessage(transition) {
  const { type } = transition

  if (type === 'upcoming') {
    const s = transition.signal
    const confidence = s.confirmed
      ? 'This one was announced, so it should be reliable.'
      : 'This is the tracker’s forecast rather than an announcement, so treat it as a heads-up.'
    return (
      '<b>Codex reset expected</b>\n\n' +
      `A usage limit reset looks likely between ${windowText(
        s
      )}. ${confidence}` +
      source(s)
    )
  }

  if (type === 'confirmed') {
    const s = transition.signal
    return (
      '<b>Codex reset confirmed</b>\n\n' +
      `The reset that was only forecast is now announced, expected between ${windowText(
        s
      )}.` +
      source(s)
    )
  }

  if (type === 'moved') {
    const s = transition.signal
    const p = transition.previous
    return (
      '<b>Codex reset window moved</b>\n\n' +
      `New evidence moved the expected reset from ${windowText(
        p
      )} to ${windowText(s)}.` +
      source(s)
    )
  }

  if (type === 'completed') {
    return (
      '<b>Codex limits have reset</b>\n\n' +
      'The reset landed, so your weekly usage is back. The calendar entry has been cleared.' +
      (transition.reset?.sourceUrl ? `\n\n${transition.reset.sourceUrl}` : '')
    )
  }

  if (type === 'withdrawn') {
    return (
      '<b>Codex reset no longer expected</b>\n\n' +
      'The forecast expired without a reset landing, so the calendar entry has been cleared. ' +
      'Nothing is wrong; the prediction simply did not come true.'
    )
  }

  if (type === 'contradiction') {
    return (
      '<b>Codex reset timing does not add up</b>\n\n' +
      `The tracker is reporting times that contradict each other (${transition.detail}), ` +
      'so no calendar entry was written. This needs a look rather than an automatic guess.'
    )
  }

  throw new Error(`No message defined for transition type: ${type}`)
}

export async function send({
  token,
  chatId,
  text,
  dryRun,
  logger,
  attempts,
  baseUrl
}) {
  if (dryRun) {
    logger.info({ text }, 'dry run: would send telegram message')
    return { sent: false, dryRun: true }
  }
  const root = baseUrl ?? `https://api.telegram.org/bot${token}`
  await withRetry(
    async () => {
      const resp = await fetch(`${root}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
      })
      if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        throw httpError(
          `Telegram API returned HTTP ${resp.status}: ${body}`,
          resp.status
        )
      }
    },
    { label: 'telegram send', logger, attempts }
  )
  return { sent: true }
}

// Credential probe. getMe is the Bot API's own auth check: a cheap read with
// no side effects. It runs every cycle because the send path only fires on a
// transition, and resets are about a week apart, so a revoked token would
// otherwise stay invisible until the next real reset.
export async function probe({ token, logger, attempts, baseUrl }) {
  const root = baseUrl ?? `https://api.telegram.org/bot${token}`
  const resp = await withRetry(
    async () => {
      const r = await fetch(`${root}/getMe`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
      })
      if (!r.ok)
        throw httpError(`Telegram getMe returned HTTP ${r.status}`, r.status)
      return r
    },
    { label: 'telegram probe', logger, attempts }
  )
  const body = await resp.json()
  // Judge on the positive. An unrecognised shape must read as unhealthy, not
  // as fine.
  if (!body.ok || !body.result?.username)
    throw new Error('Telegram getMe did not confirm the bot identity')
  return { username: body.result.username }
}
