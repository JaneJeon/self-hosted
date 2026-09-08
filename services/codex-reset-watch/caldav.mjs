import { httpError, withRetry } from './retry.mjs'
import { KNOWN_TITLES } from './normalize.mjs'
import { UID } from './transitions.mjs'

const HTTP_TIMEOUT_MS = 15_000

// The sweep looks a week back and a fortnight forward. The tracker's own
// stats put the mean interval between resets at seven days, so this is wide
// enough to find anything of ours and narrow enough to stay cheap.
const SWEEP_BACK_DAYS = 7
const SWEEP_FORWARD_DAYS = 14

// Our resource is at a fixed path, so the service never has to search for its
// own event. The sweep exists for a different job: finding strays left by an
// earlier manual workflow.
export const RESOURCE_NAME = 'codex-reset-watch.ics'

const PRODID = '-//janejeon//codex-reset-watch//EN'

const pad = n => String(n).padStart(2, '0')

// iCalendar UTC form: 20260908T010000Z
export function icalUtc(iso) {
  const d = new Date(iso)
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(
      d.getUTCSeconds()
    )}Z`
  )
}

// RFC 5545 escaping for TEXT values. A source URL can legitimately contain a
// comma, which would otherwise split the property value.
export function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, ';')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// Content lines are folded at 75 octets, per RFC 5545.
export function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // Do not split a multi-byte character.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80)
      end--
    parts.push(bytes.subarray(start, end).toString('utf8'))
    start = end
    limit = 74 // continuation lines carry a leading space
  }
  return parts.join('\r\n ')
}

// Undo the folding before anything is matched. A long SUMMARY wraps at 75
// octets, and a naive line match would miss it, report no existing event, and
// create a duplicate.
export function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, '')
}

// Build the event body.
//
// UTC instants rather than TZID plus VTIMEZONE. A TZID reference is only valid
// alongside a matching VTIMEZONE component, which is fifteen hand-maintained
// lines that go stale when DST rules change. No information is lost: the zone
// is where the window was derived, and every client renders a UTC instant in
// the viewer's own zone. Fastmail itself writes the TZID form, so this will
// look like a bug to someone reading the calendar later. It is not.
//
// preservedAlarms carries any VALARM blocks and the Fastmail default-alerts
// flag from the event already on the server. The issue says not to alter
// reminders, and because this is a whole-resource PUT, "do not alter" has to
// mean "copy forward" or a hand-added alarm is destroyed on the next window
// change.
export function buildVEvent(
  projection,
  { dtstamp, preservedAlarms = [], sequence = 0 }
) {
  const start = new Date(projection.startUtc).getTime()
  const end = new Date(projection.endUtc).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw new Error('Projection window is not a pair of instants')
  if (end <= start) throw new Error('Projection ends at or before it starts')

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${projection.uid}`,
    `DTSTAMP:${icalUtc(dtstamp)}`,
    `DTSTART:${icalUtc(projection.startUtc)}`,
    `DTEND:${icalUtc(projection.endUtc)}`,
    `SUMMARY:${escapeText(projection.summary)}`
  ]
  // Only the best specific source URL, and the property is omitted entirely
  // when the source carries none. Nothing is ever synthesized from the CalDAV
  // href, which would be inventing an event URL.
  if (projection.description)
    lines.push(`DESCRIPTION:${escapeText(projection.description)}`)
  lines.push(`SEQUENCE:${sequence}`)
  // A forecast should not mark Jane busy.
  lines.push('TRANSP:TRANSPARENT')
  lines.push(...preservedAlarms)
  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.map(foldLine).join('\r\n') + '\r\n'
}

// Pull the alarm-bearing parts out of an existing body so they survive a
// rewrite. VALARM blocks are copied verbatim, as is Fastmail's default-alerts
// property, which is what actually drives reminders on an event created in
// their UI.
export function extractAlarms(ics) {
  if (!ics) return []
  const text = unfold(ics)
  const out = []
  const alarms = text.match(/BEGIN:VALARM[\s\S]*?END:VALARM/g) ?? []
  for (const block of alarms) out.push(...block.split(/\r?\n/).filter(Boolean))
  for (const line of text.split(/\r?\n/))
    if (/^X-JMAP-USEDEFAULTALERTS[;:]/i.test(line)) out.push(line)
  return out
}

export function parseIcs(ics) {
  const text = unfold(ics)
  const read = name => {
    const m = text.match(new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'mi'))
    return m ? m[1].trim() : null
  }
  const seq = read('SEQUENCE')
  return {
    uid: read('UID'),
    summary: read('SUMMARY'),
    description: read('DESCRIPTION'),
    sequence: seq === null ? 0 : Number(seq)
  }
}

// Split a 207 into responses. Namespace prefixes vary by server (Fastmail's
// Cyrus uses d:/c:), so the prefix is matched loosely.
export function parseMultiStatus(xml) {
  const out = []
  const blocks = xml.split(/<[a-zA-Z0-9]*:?response>/i).slice(1)
  for (const block of blocks) {
    const href = block.match(
      /<[a-zA-Z0-9]*:?href>([^<]*)<\/[a-zA-Z0-9]*:?href>/i
    )
    const etag = block.match(
      /<[a-zA-Z0-9]*:?getetag>([^<]*)<\/[a-zA-Z0-9]*:?getetag>/i
    )
    const data = block.match(
      /<[a-zA-Z0-9]*:?calendar-data[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/[a-zA-Z0-9]*:?calendar-data>/i
    )
    if (!href) continue
    out.push({
      href: decodeEntities(href[1]),
      etag: etag ? etag[1].trim() : null,
      ics: data ? decodeEntities(data[1]) : null
    })
  }
  return out
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

// Partition what the sweep found.
//
// Deletion is gated on an exact title match, never a prefix. Jane's Events
// calendar holds her own appointments, so a prefix rule could destroy one
// irrecoverably, while a missed stray is a visible duplicate she can remove
// herself. The costs are asymmetric, so the rule is too.
export function classify(entries, { ourHref }) {
  const ours = []
  const strays = []
  const suspects = []
  for (const entry of entries) {
    if (!entry.ics) continue
    const parsed = parseIcs(entry.ics)
    const item = { ...entry, ...parsed }
    if (parsed.uid === UID || entry.href === ourHref) ours.push(item)
    else if (KNOWN_TITLES.includes(parsed.summary)) strays.push(item)
    else if (
      parsed.summary &&
      /^Codex Usage Limit Reset\b/i.test(parsed.summary)
    )
      suspects.push(item)
  }
  return { ours, strays, suspects }
}

export function createCalDavClient({
  calendarUrl,
  username,
  password,
  logger,
  dryRun = false,
  now = () => new Date(),
  // Overridable so tests do not sit through the real backoff ladder.
  attempts = undefined
}) {
  const base = calendarUrl.endsWith('/') ? calendarUrl : calendarUrl + '/'
  const ourHref = new URL(RESOURCE_NAME, base).pathname
  const auth =
    'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')

  async function request(method, url, { headers = {}, body } = {}) {
    const resp = await fetch(url, {
      method,
      headers: { Authorization: auth, ...headers },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    })
    return resp
  }

  return {
    ourHref,

    // Also the CalDAV credential probe. It runs every cycle whether or not
    // anything needs writing, because the write path only fires on a
    // transition and resets are about a week apart. Without this, a dead
    // credential would stay invisible until the next real reset.
    async sweep() {
      const from = new Date(now().getTime() - SWEEP_BACK_DAYS * 86400_000)
      const to = new Date(now().getTime() + SWEEP_FORWARD_DAYS * 86400_000)
      const body =
        '<?xml version="1.0" encoding="utf-8" ?>' +
        '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
        '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
        '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
        `<c:time-range start="${icalUtc(from.toISOString())}" end="${icalUtc(
          to.toISOString()
        )}"/>` +
        '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>'

      const resp = await withRetry(
        async () => {
          const r = await request('REPORT', base, {
            headers: {
              Depth: '1',
              'Content-Type': 'application/xml; charset=utf-8'
            },
            body
          })
          if (r.status !== 207)
            throw httpError(`CalDAV REPORT returned HTTP ${r.status}`, r.status)
          return r
        },
        { label: 'caldav sweep', logger, attempts }
      )

      const entries = parseMultiStatus(await resp.text())
      const found = classify(entries, { ourHref })
      for (const s of found.suspects)
        logger.warn(
          { href: s.href, summary: s.summary },
          'event looks like ours but its title is not an exact match, leaving it alone'
        )
      return found
    },

    async put(projection, { href, etag, preservedAlarms, sequence }) {
      const target = new URL(href ?? RESOURCE_NAME, base).toString()
      const body = buildVEvent(projection, {
        dtstamp: now().toISOString(),
        preservedAlarms,
        sequence
      })

      if (dryRun) {
        logger.info(
          { href: href ?? ourHref, body },
          'dry run: would write event'
        )
        return { href: href ?? ourHref, etag: null, dryRun: true }
      }

      // Always conditional. If-None-Match: * refuses to overwrite something we
      // did not know was there; If-Match refuses to clobber an edit made since
      // we last looked.
      const headers = {
        'Content-Type': 'text/calendar; charset=utf-8',
        ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' })
      }
      const resp = await withRetry(
        async () => {
          const r = await request('PUT', target, { headers, body })
          if (r.status === 412) return r
          if (!r.ok)
            throw httpError(`CalDAV PUT returned HTTP ${r.status}`, r.status)
          return r
        },
        { label: 'caldav put', logger, attempts }
      )

      if (resp.status === 412) return { conflict: true, href: href ?? ourHref }

      // Servers may legally rewrite the resource and omit the ETag, in which
      // case the next write reads it back first rather than going unconditional.
      return { href: href ?? ourHref, etag: resp.headers.get('ETag') ?? null }
    },

    async remove({ href, etag }) {
      const target = new URL(href, base).toString()
      if (dryRun) {
        logger.info({ href }, 'dry run: would delete event')
        return { deleted: false, dryRun: true }
      }
      const resp = await withRetry(
        async () => {
          const r = await request('DELETE', target, {
            headers: etag ? { 'If-Match': etag } : {}
          })
          // Already gone is the outcome we wanted.
          if (r.status === 404) return r
          if (r.status === 412) return r
          if (!r.ok)
            throw httpError(`CalDAV DELETE returned HTTP ${r.status}`, r.status)
          return r
        },
        { label: 'caldav delete', logger, attempts }
      )
      if (resp.status === 412) return { deleted: false, conflict: true }
      return { deleted: true }
    },

    async get(href) {
      const target = new URL(href, base).toString()
      const resp = await request('GET', target, {
        headers: { Accept: 'text/calendar' }
      })
      if (resp.status === 404) return null
      if (!resp.ok)
        throw httpError(`CalDAV GET returned HTTP ${resp.status}`, resp.status)
      return { ics: await resp.text(), etag: resp.headers.get('ETag') }
    }
  }
}
