import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import {
  buildVEvent,
  classify,
  createCalDavClient,
  escapeText,
  extractAlarms,
  foldLine,
  parseIcs,
  parseMultiStatus,
  unfold
} from './caldav.mjs'
import { TITLE_UNCONFIRMED } from './normalize.mjs'
import { UID } from './transitions.mjs'

const fixture = name =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} }

const projection = {
  uid: UID,
  summary: TITLE_UNCONFIRMED,
  startUtc: '2026-09-09T01:00:00.000Z',
  endUtc: '2026-09-09T02:00:00.000Z',
  description: 'https://x.com/thsottiaux/status/2096'
}

const multiStatus = responses =>
  '<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
  responses
    .map(
      r =>
        `<d:response><d:href>${r.href}</d:href><d:propstat><d:prop>` +
        `<d:getetag>${r.etag}</d:getetag>` +
        `<c:calendar-data><![CDATA[${r.ics}]]></c:calendar-data>` +
        `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
    )
    .join('') +
  '</d:multistatus>'

async function withServer(handler, run) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    return await run(`http://127.0.0.1:${port}/cal/`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

test('a folded SUMMARY is unfolded before anything is matched', () => {
  // A long line wraps at 75 octets. Matching without unfolding first would
  // miss the event, report nothing found, and create a duplicate.
  const ics = fixture('event-ours-with-alarm.ics')
  assert.match(ics, /\r\n /, 'the fixture must actually contain a folded line')
  const parsed = parseIcs(ics)
  assert.equal(
    parsed.description,
    'https://x.com/thsottiaux/status/2096123456789012345'
  )
  assert.equal(parsed.uid, UID)
})

test('folding and unfolding round-trip a long value', () => {
  const long = 'DESCRIPTION:' + 'https://example.com/' + 'a'.repeat(200)
  assert.equal(unfold(foldLine(long)), long)
})

test('a comma in a source URL is escaped rather than splitting the property', () => {
  assert.equal(escapeText('https://x.com/a,b'), 'https://x.com/a\\,b')
})

test('alarms and the Fastmail default-alerts flag survive extraction', () => {
  const alarms = extractAlarms(fixture('event-ours-with-alarm.ics'))
  assert.ok(alarms.includes('BEGIN:VALARM'))
  assert.ok(alarms.includes('TRIGGER:-PT15M'))
  assert.ok(alarms.some(l => /^X-JMAP-USEDEFAULTALERTS/.test(l)))
})

test('a rewrite carries reminders forward instead of destroying them', () => {
  // The issue says not to alter reminders. Because this is a whole-resource
  // PUT, "do not alter" has to mean "copy forward".
  const preserved = extractAlarms(fixture('event-ours-with-alarm.ics'))
  const body = buildVEvent(projection, {
    dtstamp: '2026-09-08T04:15:00.000Z',
    preservedAlarms: preserved,
    sequence: 4
  })
  assert.match(body, /BEGIN:VALARM/)
  assert.match(body, /TRIGGER:-PT15M/)
  assert.match(body, /X-JMAP-USEDEFAULTALERTS/)
})

test('the event is written as UTC instants and is never all-day', () => {
  const body = buildVEvent(projection, { dtstamp: '2026-09-08T04:15:00.000Z' })
  assert.match(body, /DTSTART:20260909T010000Z/)
  assert.match(body, /DTEND:20260909T020000Z/)
  assert.doesNotMatch(body, /VALUE=DATE/)
  assert.doesNotMatch(body, /TZID/)
  assert.match(body, /TRANSP:TRANSPARENT/)
})

test('a source with no url omits the description entirely', () => {
  const body = buildVEvent(
    { ...projection, description: null },
    { dtstamp: '2026-09-08T04:15:00.000Z' }
  )
  assert.doesNotMatch(body, /DESCRIPTION/)
  assert.doesNotMatch(body, /^URL:/m, 'no event URL is ever synthesized')
})

test('an inverted or zero-length window is refused before it reaches the server', () => {
  assert.throws(
    () =>
      buildVEvent(
        { ...projection, endUtc: projection.startUtc },
        { dtstamp: projection.startUtc }
      ),
    /ends at or before/
  )
})

test('multistatus parsing survives CDATA, entities and either namespace prefix', () => {
  const xml =
    '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/cal/a.ics</D:href>' +
    '<D:getetag>"e9"</D:getetag><C:calendar-data>BEGIN:VEVENT&#39;s</C:calendar-data>' +
    '</D:response></D:multistatus>'
  const [entry] = parseMultiStatus(xml)
  assert.equal(entry.href, '/cal/a.ics')
  assert.equal(entry.etag, '"e9"')
  assert.match(entry.ics, /BEGIN:VEVENT's/)
})

test('the sweep separates ours, exact-title strays, and untouchable suspects', () => {
  const entries = [
    {
      href: '/cal/codex-reset-watch.ics',
      etag: '"1"',
      ics: fixture('event-ours-with-alarm.ics')
    },
    {
      href: '/cal/47a9d1cb.ics',
      etag: '"2"',
      ics: fixture('event-legacy-stale.ics')
    },
    {
      href: '/cal/other.ics',
      etag: '"3"',
      ics: 'BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Codex Usage Limit Reset soon maybe\r\nEND:VEVENT'
    },
    {
      href: '/cal/dr.ics',
      etag: '"4"',
      ics: 'BEGIN:VEVENT\r\nUID:y\r\nSUMMARY:Dr Yeager\r\nEND:VEVENT'
    }
  ]
  const found = classify(entries, { ourHref: '/cal/codex-reset-watch.ics' })
  assert.equal(found.ours.length, 1)
  assert.equal(found.strays.length, 1, 'exact-title match only')
  assert.equal(found.strays[0].href, '/cal/47a9d1cb.ics')
  assert.equal(
    found.suspects.length,
    1,
    'a prefix match is a suspect, never a stray'
  )
  // Jane's own appointments must never appear in any deletable bucket.
  const deletable = [...found.strays, ...found.ours].map(e => e.href)
  assert.ok(!deletable.includes('/cal/dr.ics'))
  assert.ok(!deletable.includes('/cal/other.ics'))
})

test('sweep issues a REPORT and classifies what comes back', () => {
  return withServer(
    (req, res) => {
      assert.equal(req.method, 'REPORT')
      assert.equal(req.headers.depth, '1')
      assert.match(req.headers.authorization, /^Basic /)
      res.writeHead(207, { 'Content-Type': 'application/xml' })
      res.end(
        multiStatus([
          {
            href: '/cal/codex-reset-watch.ics',
            etag: '"1"',
            ics: fixture('event-ours-with-alarm.ics')
          }
        ])
      )
    },
    async calendarUrl => {
      const client = createCalDavClient({
        calendarUrl,
        username: 'u',
        password: 'p',
        logger: quietLogger
      })
      const found = await client.sweep()
      assert.equal(found.ours.length, 1)
      assert.equal(found.ours[0].etag, '"1"')
    }
  )
})

test('a create is conditional on the resource not already existing', () => {
  return withServer(
    (req, res) => {
      assert.equal(req.method, 'PUT')
      assert.equal(req.headers['if-none-match'], '*')
      res.writeHead(201, { ETag: '"new"' })
      res.end()
    },
    async calendarUrl => {
      const client = createCalDavClient({
        calendarUrl,
        username: 'u',
        password: 'p',
        logger: quietLogger
      })
      const r = await client.put(projection, {})
      assert.equal(r.etag, '"new"')
    }
  )
})

test('an update is conditional on the etag, and a 412 reports a conflict rather than clobbering', () => {
  return withServer(
    (req, res) => {
      assert.equal(req.headers['if-match'], '"old"')
      res.writeHead(412)
      res.end()
    },
    async calendarUrl => {
      const client = createCalDavClient({
        calendarUrl,
        username: 'u',
        password: 'p',
        logger: quietLogger
      })
      const r = await client.put(projection, {
        etag: '"old"',
        href: '/cal/codex-reset-watch.ics'
      })
      assert.equal(r.conflict, true)
    }
  )
})

test('a delete of something already gone is a success', () => {
  return withServer(
    (req, res) => {
      assert.equal(req.method, 'DELETE')
      res.writeHead(404)
      res.end()
    },
    async calendarUrl => {
      const client = createCalDavClient({
        calendarUrl,
        username: 'u',
        password: 'p',
        logger: quietLogger
      })
      const r = await client.remove({ href: '/cal/gone.ics', etag: '"e"' })
      assert.equal(r.deleted, true)
    }
  )
})

test('a failing write retries the 5xx and then gives up loudly', () => {
  let hits = 0
  return withServer(
    (req, res) => {
      hits++
      res.writeHead(500)
      res.end()
    },
    async calendarUrl => {
      const client = createCalDavClient({
        calendarUrl,
        username: 'u',
        password: 'p',
        logger: { ...quietLogger, warn: () => {} },
        attempts: 2
      })
      await assert.rejects(client.put(projection, {}), /HTTP 500/)
      assert.equal(hits, 2, 'a 5xx is retried, then surfaces')
    }
  )
})

test('dry run logs the exact body it would have written and sends nothing', () => {
  const lines = []
  const client = createCalDavClient({
    calendarUrl: 'http://127.0.0.1:1/cal/',
    username: 'u',
    password: 'p',
    logger: { ...quietLogger, info: (o, m) => lines.push({ ...o, m }) },
    dryRun: true
  })
  return client.put(projection, {}).then(r => {
    assert.equal(r.dryRun, true)
    const logged = lines.find(l => l.m === 'dry run: would write event')
    assert.match(logged.body, /SUMMARY:Codex Usage Limit Reset \(Unconfirmed\)/)
  })
})
