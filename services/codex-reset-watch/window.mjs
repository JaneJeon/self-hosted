// Deriving a time window from the tracker's evidence.
//
// Everything here is pure: no clock, no network. Times come in as milliseconds
// and go out as milliseconds, so a stored payload replays identically.
//
// The design is driven by the tracker's own history rather than by guesswork.
// All 52 announcements were read before this was written. Two facts came out
// of that and shape every rule below.
//
// First, the dominant real form is a duration measured from the announcement
// ("Lands in the next hour", "Should land over next 30 minutes", "First one
// will land in ~ 3 hours"), not an absolute clock time. Not one record used
// "by <time>".
//
// Second, and more important, five expressions in that corpus would fool an
// unanchored parser, and each would have produced a wrong calendar entry
// without saying anything:
//
//   "usage dropped around 10% for users..."        a percentage
//   "Last night around 2am to 4am ... outage"      an outage, not a reset
//   "This was fixed in ~8 mins"                    how long a fix took
//   "before 8pm PT you will get it too"            an eligibility deadline
//   "credit one additional reset ... over the      how long a bank credit
//    next 24 hours"                                lasts
//
// So a time only counts when it sits in a clause that also says the reset is
// landing, and anything time-shaped we do not recognise makes the whole thing
// unparseable rather than empty. Failing loudly is the point: an unparseable
// window is a missing heartbeat and a logged sample, which costs one alert. An
// invented window is a wrong entry on a real calendar, which costs trust.

export const DEFAULT_ZONE = 'America/Los_Angeles'

// "around T" with nothing else becomes T to T plus one hour.
export const DEFAULT_DURATION_MS = 60 * 60 * 1000

// Two bounds further apart than this are treated as describing different
// things rather than one window. Six hours is wider than any observed
// announcement and narrow enough that a mis-pairing still surfaces.
export const MAX_WINDOW_MS = 6 * 60 * 60 * 1000

// Two "around" claims closer than this are the same claim said twice.
export const ANCHOR_TOLERANCE_MS = 15 * 60 * 1000

// A bare clock time is resolved to its first occurrence at or after the
// announcement, within this horizon.
const DAY_MS = 24 * 60 * 60 * 1000

// A time is only believed inside a clause that also says the reset is landing.
// This is the rule that rejects all five corpus false positives above.
const LANDING_VERB =
  /\b(lands?|landing|landed|propagat\w+|arriv\w+|will be (fully )?reset|will come)\b/i

// Clauses split on sentence boundaries and on coordinating conjunctions. The
// conjunction split is load-bearing: one real announcement reads "...will be
// fully reset again in the next hour and we will credit one additional reset
// ... over the next 24 hours", where the first half is the reset landing and
// the second half is a bank credit. Splitting only on sentences would pull two
// durations out of one clause.
const CLAUSE_SPLIT = /(?<=[.!?])\s+|\n+|\s+\band\b\s+|\s+\bbut\b\s+/i

// Anything time-shaped left over after the recognised claims are removed.
// Matching here means the text said something temporal that we did not
// understand, which is exactly when guessing is most dangerous.
const RESIDUE = [
  /\b\d{1,2}\s*(a\.?m\.?|p\.?m\.?)\b/i,
  /\b\d{1,2}:\d{2}\b/,
  /\b\d+\s*(hours?|hrs?|minutes?|mins?)\b/i,
  /\b(tomorrow|tonight|noon|midnight|eod|end of (the )?day|morning|afternoon|evening|later today|later in the day|during the day|shortly|soon|imminently)\b/i
]

const FIXED_ZONES = { UTC: 0, GMT: 0, Z: 0 }
const NAMED_ZONES = {
  PT: 'America/Los_Angeles',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  PACIFIC: 'America/Los_Angeles',
  ET: 'America/New_York',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  EASTERN: 'America/New_York'
}

// Wall-clock fields for an instant, in a named zone.
export function partsIn(ms, zone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const out = {}
  for (const { type, value } of fmt.formatToParts(new Date(ms)))
    if (type !== 'literal') out[type] = Number(value)
  return out
}

function offsetAt(ms, zone) {
  const p = partsIn(ms, zone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms
}

// Turn a wall-clock time in a named zone into an instant.
//
// `Date` cannot do this: constructing the instant needs the offset, and
// reading the offset needs an instant. Two passes settle it, and the round
// trip afterwards is a correctness check rather than decoration. On the
// spring-forward gap the requested wall time does not exist, the round trip
// disagrees, and this returns null so the caller can report a contradiction. A
// date library would silently slide the time an hour instead.
//
// On the autumn fall-back the same wall time happens twice. The two-pass probe
// deterministically returns the earlier (daylight) occurrence, which widens
// coverage rather than narrowing it. A test pins the exact instant so a
// refactor cannot flip it quietly.
export function zonedToUtc(year, month, day, hour, minute, zone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const first = offsetAt(wall, zone)
  let ts = wall - first
  const second = offsetAt(ts, zone)
  if (second !== first) ts = wall - second
  const back = partsIn(ts, zone)
  if (
    back.year !== year ||
    back.month !== month ||
    back.day !== day ||
    back.hour !== hour ||
    back.minute !== minute
  )
    return null
  return ts
}

function resolveZone(token) {
  if (!token) return { kind: 'named', zone: DEFAULT_ZONE }
  const upper = token.toUpperCase().replace(/\./g, '')
  if (upper in FIXED_ZONES) return { kind: 'fixed', offsetMs: 0 }
  if (upper in NAMED_ZONES) return { kind: 'named', zone: NAMED_ZONES[upper] }
  const m = upper.match(/^([+-])(\d{2}):?(\d{2})$/)
  if (m) {
    const sign = m[1] === '-' ? -1 : 1
    const offsetMs = sign * (Number(m[2]) * 60 + Number(m[3])) * 60 * 1000
    return { kind: 'fixed', offsetMs }
  }
  return null
}

// Hour and minute from a matched clock time, or null when the shape is not a
// time at all. A bare number is refused: "around 10%" must not become 10:00.
function readClock(hourText, minuteText, meridiemText) {
  let hour = Number(hourText)
  const minute = minuteText === undefined ? 0 : Number(minuteText)
  const meridiem = meridiemText
    ? meridiemText.toLowerCase().replace(/\./g, '')
    : null
  if (!meridiem && minuteText === undefined) return null
  if (minute > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    if (meridiem === 'pm' && hour !== 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
  } else if (hour > 23) return null
  return { hour, minute }
}

// Place a wall-clock time on the first date at or after the announcement.
function clockToInstant(clock, zoneToken, evidenceAtMs) {
  const zone = resolveZone(zoneToken)
  if (!zone) return null
  if (zone.kind === 'fixed') {
    const base = new Date(evidenceAtMs + zone.offsetMs)
    let ts =
      Date.UTC(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate(),
        clock.hour,
        clock.minute
      ) - zone.offsetMs
    if (ts < evidenceAtMs) ts += DAY_MS
    return ts < evidenceAtMs + DAY_MS ? ts : null
  }
  const here = partsIn(evidenceAtMs, zone.zone)
  for (const dayShift of [0, 1]) {
    const probe = partsIn(
      Date.UTC(here.year, here.month - 1, here.day + dayShift, 12) -
        offsetAt(evidenceAtMs, zone.zone),
      zone.zone
    )
    const ts = zonedToUtc(
      probe.year,
      probe.month,
      probe.day,
      clock.hour,
      clock.minute,
      zone.zone
    )
    if (ts === null) return { nonexistent: true }
    if (ts >= evidenceAtMs) return ts
  }
  return null
}

const DURATION_UNIT_MS = {
  min: 60 * 1000,
  mins: 60 * 1000,
  minute: 60 * 1000,
  minutes: 60 * 1000,
  hr: 60 * 60 * 1000,
  hrs: 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  hours: 60 * 60 * 1000
}

const CLOCK_SRC = '(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?'
const TZ_SRC =
  '(?:\\s*(PST|PDT|PT|Pacific|EST|EDT|ET|Eastern|UTC|GMT|Z|[+-]\\d{2}:?\\d{2}))?'
const ISO_SRC =
  '\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})'

// The v1 allowlist. Every pattern here was either seen in the tracker's own
// history or is the obvious machine-generated shape for a field named
// forecast_window. Anything outside it fails loudly by design.
const PATTERNS = [
  {
    name: 'iso-interval',
    re: new RegExp(`(${ISO_SRC})\\s*/\\s*(${ISO_SRC})`, 'i'),
    build: m => {
      const start = Date.parse(m[1])
      const end = Date.parse(m[2])
      if (Number.isNaN(start) || Number.isNaN(end)) return null
      return { kind: 'range', startMs: start, endMs: end }
    }
  },
  {
    name: 'by-iso',
    re: new RegExp(`(?:by|before|until|no later than)\\s+(${ISO_SRC})`, 'i'),
    build: m => {
      const at = Date.parse(m[1])
      return Number.isNaN(at) ? null : { kind: 'by', endMs: at }
    }
  },
  {
    name: 'around-iso',
    re: new RegExp(`(?:around|about|approximately|at)\\s+(${ISO_SRC})`, 'i'),
    build: m => {
      const at = Date.parse(m[1])
      return Number.isNaN(at) ? null : { kind: 'around', startMs: at }
    }
  },
  {
    name: 'between',
    re: new RegExp(
      `between\\s+${CLOCK_SRC}\\s+and\\s+${CLOCK_SRC}${TZ_SRC}`,
      'i'
    ),
    build: (m, ctx) => {
      const a = readClock(m[1], m[2], m[3])
      const b = readClock(m[4], m[5], m[6])
      if (!a || !b) return null
      const start = clockToInstant(a, m[7], ctx.evidenceAtMs)
      const end = clockToInstant(b, m[7], ctx.evidenceAtMs)
      return rangeFrom(start, end)
    }
  },
  {
    name: 'dash-range',
    re: new RegExp(
      `${CLOCK_SRC}\\s*(?:-|–|—|to)\\s*${CLOCK_SRC}${TZ_SRC}`,
      'i'
    ),
    build: (m, ctx) => {
      const a = readClock(m[1], m[2], m[3])
      const b = readClock(m[4], m[5], m[6])
      if (!a || !b) return null
      const start = clockToInstant(a, m[7], ctx.evidenceAtMs)
      const end = clockToInstant(b, m[7], ctx.evidenceAtMs)
      return rangeFrom(start, end)
    }
  },
  {
    name: 'relative-next',
    re: /(?:in|over|within)\s+(?:the\s+)?next\s+(?:(\d+)\s*)?(minutes?|mins?|hours?|hrs?)/i,
    build: (m, ctx) => {
      const unit = DURATION_UNIT_MS[m[2].toLowerCase()]
      if (!unit) return null
      const count = m[1] === undefined ? 1 : Number(m[1])
      return { kind: 'by', endMs: ctx.evidenceAtMs + count * unit }
    }
  },
  {
    name: 'relative-approx',
    re: /(?:in\s+)?~\s*(\d+)\s*(minutes?|mins?|hours?|hrs?)/i,
    build: (m, ctx) => {
      const unit = DURATION_UNIT_MS[m[2].toLowerCase()]
      if (!unit) return null
      return {
        kind: 'around',
        startMs: ctx.evidenceAtMs + Number(m[1]) * unit
      }
    }
  },
  {
    name: 'by',
    re: new RegExp(
      `(?:by|before|until|no later than)\\s+${CLOCK_SRC}${TZ_SRC}`,
      'i'
    ),
    build: (m, ctx) => {
      const clock = readClock(m[1], m[2], m[3])
      if (!clock) return null
      const at = clockToInstant(clock, m[4], ctx.evidenceAtMs)
      if (at === null) return null
      if (at && at.nonexistent) return { nonexistent: true }
      return { kind: 'by', endMs: at }
    }
  },
  {
    name: 'around',
    re: new RegExp(
      `(?:around|about|approximately|~)\\s*${CLOCK_SRC}${TZ_SRC}`,
      'i'
    ),
    build: (m, ctx) => {
      const clock = readClock(m[1], m[2], m[3])
      if (!clock) return null
      const at = clockToInstant(clock, m[4], ctx.evidenceAtMs)
      if (at === null) return null
      if (at && at.nonexistent) return { nonexistent: true }
      return { kind: 'around', startMs: at }
    }
  },
  {
    name: 'at',
    re: new RegExp(`\\bat\\s+${CLOCK_SRC}${TZ_SRC}`, 'i'),
    build: (m, ctx) => {
      const clock = readClock(m[1], m[2], m[3])
      if (!clock) return null
      const at = clockToInstant(clock, m[4], ctx.evidenceAtMs)
      if (at === null) return null
      if (at && at.nonexistent) return { nonexistent: true }
      return { kind: 'around', startMs: at }
    }
  },
  // Last, so a prefixed form always claims its timestamp first.
  {
    name: 'iso-instant',
    re: new RegExp(`(${ISO_SRC})`, 'i'),
    build: m => {
      const at = Date.parse(m[1])
      return Number.isNaN(at) ? null : { kind: 'around', startMs: at }
    }
  }
]

function rangeFrom(start, end) {
  if (start === null || end === null) return null
  if (start && start.nonexistent) return { nonexistent: true }
  if (end && end.nonexistent) return { nonexistent: true }
  return { kind: 'range', startMs: start, endMs: end }
}

// Pull every recognised claim out of one string, returning what was matched
// and what text was left untouched.
export function parseClaims(text, { evidenceAtMs }) {
  if (!text) return { claims: [], anchored: false, residue: '' }
  const claims = []
  let anchored = false
  let residue = ''

  for (const clause of text.split(CLAUSE_SPLIT)) {
    if (!clause) continue
    if (!LANDING_VERB.test(clause)) continue
    anchored = true
    let rest = clause
    for (const pattern of PATTERNS) {
      const m = rest.match(pattern.re)
      if (!m) continue
      const claim = pattern.build(m, { evidenceAtMs })
      if (claim && claim.nonexistent)
        return { claims: [], anchored, residue: '', nonexistent: true }
      if (!claim) continue
      claims.push({ ...claim, pattern: pattern.name, matched: m[0] })
      rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length)
    }
    residue += ' ' + rest
  }

  return { claims, anchored, residue: residue.trim() }
}

function hasTimeShapedResidue(residue) {
  return RESIDUE.some(re => re.test(residue))
}

// Combine claims into a window. Never averages, never shifts, never recenters.
// The historical bug (around 6pm PST plus by 02:00 UTC rendered as 18:30-19:30)
// cannot recur because no code path here computes a midpoint.
export function combine(claims, { evidenceAtMs }) {
  const ranges = claims.filter(c => c.kind === 'range')
  const arounds = claims.filter(c => c.kind === 'around')
  const bys = claims.filter(c => c.kind === 'by')

  if (ranges.length) {
    const r = ranges[0]
    if (r.endMs <= r.startMs)
      return {
        ok: false,
        reason: 'contradiction',
        detail: 'range ends at or before it starts'
      }
    if (r.endMs - r.startMs > MAX_WINDOW_MS)
      return {
        ok: false,
        reason: 'contradiction',
        detail: 'range wider than the maximum'
      }
    return { ok: true, startMs: r.startMs, endMs: r.endMs, basis: 'range' }
  }

  if (arounds.length > 1) {
    const spread =
      Math.max(...arounds.map(a => a.startMs)) -
      Math.min(...arounds.map(a => a.startMs))
    if (spread > ANCHOR_TOLERANCE_MS)
      return {
        ok: false,
        reason: 'contradiction',
        detail: 'two anchors disagree'
      }
  }

  const around = arounds.length
    ? Math.min(...arounds.map(a => a.startMs))
    : null
  const by = bys.length ? Math.min(...bys.map(b => b.endMs)) : null

  if (around !== null && by !== null) {
    if (by <= around)
      return {
        ok: false,
        reason: 'contradiction',
        detail: 'upper bound at or before the anchor'
      }
    if (by - around > MAX_WINDOW_MS)
      return {
        ok: false,
        reason: 'contradiction',
        detail: 'bounds further apart than the maximum'
      }
    return { ok: true, startMs: around, endMs: by, basis: 'around+by' }
  }

  if (around !== null)
    return {
      ok: true,
      startMs: around,
      endMs: around + DEFAULT_DURATION_MS,
      basis: 'around'
    }

  // "by U" on its own is an upper bound and nothing else. The window runs from
  // the announcement to U. Starting an hour before U would be inventing a
  // start time, which is the same mistake as recentering, just smaller.
  if (by !== null) {
    if (by <= evidenceAtMs)
      return {
        ok: false,
        reason: 'contradiction',
        detail: 'upper bound before the announcement'
      }
    if (by - evidenceAtMs > MAX_WINDOW_MS)
      return {
        ok: false,
        reason: 'contradiction',
        detail: 'upper bound further out than the maximum'
      }
    return { ok: true, startMs: evidenceAtMs, endMs: by, basis: 'by' }
  }

  return null
}

// Derive a window for one upcoming signal.
//
// Structured input always wins. scheduled_for is a real instant and needs no
// parsing; only forecast_window and text are prose.
export function deriveWindow(
  { scheduledFor, forecastWindow, text, evidenceAt },
  { logger } = {}
) {
  const evidenceAtMs = Date.parse(evidenceAt)
  if (Number.isNaN(evidenceAtMs))
    return {
      ok: false,
      reason: 'unparseable',
      detail: 'evidence has no usable timestamp'
    }

  const claims = []
  let anchoredAnywhere = false
  let residue = ''

  if (scheduledFor) {
    const at = Date.parse(scheduledFor)
    if (Number.isNaN(at))
      return {
        ok: false,
        reason: 'unparseable',
        detail: 'scheduled_for is not a timestamp'
      }
    // scheduled_for is when the announcement says the reset happens. It is an
    // upper bound, not a midpoint: the spec is explicit that a passed
    // scheduled_for does not imply completion.
    claims.push({
      kind: 'by',
      endMs: at,
      pattern: 'scheduled_for',
      matched: scheduledFor
    })
    anchoredAnywhere = true
  }

  for (const [field, value] of [
    ['forecast_window', forecastWindow],
    ['text', text]
  ]) {
    if (!value) continue
    const found = parseClaims(value, { evidenceAtMs })
    if (found.nonexistent)
      return {
        ok: false,
        reason: 'contradiction',
        detail: `${field} names a wall-clock time that does not exist on that date`
      }
    if (found.anchored) anchoredAnywhere = true
    claims.push(...found.claims.map(c => ({ ...c, field })))
    residue += ' ' + found.residue
  }

  logger?.info(
    {
      claims: claims.map(c => ({
        kind: c.kind,
        pattern: c.pattern,
        matched: c.matched
      })),
      anchored: anchoredAnywhere,
      residue: residue.trim() || null
    },
    'window claims'
  )

  const combined = combine(claims, { evidenceAtMs })

  if (!combined) {
    // Nothing recognised. If the text still holds something time-shaped, it
    // said something temporal we did not understand, and that is exactly when
    // an empty result is more dangerous than an alert.
    const detail = hasTimeShapedResidue(residue)
      ? 'time-shaped text that no allowlist pattern matched'
      : 'no temporal claim found'
    logger?.warn(
      {
        forecastWindow: forecastWindow ?? null,
        text: text ?? null,
        residue: residue.trim()
      },
      'window unparseable'
    )
    return { ok: false, reason: 'unparseable', detail }
  }

  if (!combined.ok) {
    logger?.warn(
      {
        forecastWindow: forecastWindow ?? null,
        text: text ?? null,
        detail: combined.detail
      },
      'window contradictory'
    )
    return combined
  }

  return combined
}
