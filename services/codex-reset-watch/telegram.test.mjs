import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { buildMessage, probe, send } from './telegram.mjs'

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} }

const signal = (over = {}) => ({
  confirmed: false,
  sourceUrl: 'https://x.com/thsottiaux/status/2096',
  windowStartUtc: '2026-09-08T01:00:00.000Z',
  windowEndUtc: '2026-09-08T02:00:00.000Z',
  ...over
})

async function withServer(handler, run) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    return await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

test('messages read in Pacific time, which is where Jane reads them', () => {
  const text = buildMessage({ type: 'upcoming', signal: signal() })
  assert.match(text, /6:00 PM/)
  assert.match(text, /7:00 PM/)
})

test('a forecast says it is a forecast, and an announcement says it is reliable', () => {
  assert.match(buildMessage({ type: 'upcoming', signal: signal() }), /heads-up/)
  assert.match(
    buildMessage({ type: 'upcoming', signal: signal({ confirmed: true }) }),
    /announced/
  )
})

test('a message with no source URL carries no dangling link', () => {
  const text = buildMessage({
    type: 'upcoming',
    signal: signal({ sourceUrl: null })
  })
  assert.doesNotMatch(text, /https?:/)
})

test('a withdrawal explains that nothing is broken', () => {
  const text = buildMessage({ type: 'withdrawn' })
  assert.match(text, /Nothing is wrong/)
})

test('every transition type the decider emits has a message', () => {
  const cases = [
    { type: 'upcoming', signal: signal() },
    { type: 'confirmed', signal: signal({ confirmed: true }) },
    { type: 'moved', signal: signal(), previous: signal() },
    { type: 'completed', reset: { sourceUrl: 'https://x.com/a' } },
    { type: 'withdrawn' },
    { type: 'contradiction', detail: 'upper bound before the anchor' }
  ]
  for (const c of cases) {
    const text = buildMessage(c)
    assert.match(
      text,
      /^<b>.+<\/b>\n\n/,
      `${c.type} needs a bold title then prose`
    )
  }
})

test('an unknown transition throws rather than sending an empty message', () => {
  assert.throws(() => buildMessage({ type: 'nope' }), /No message defined/)
})

test('sending posts HTML to the Bot API', async () => {
  let body = null
  await withServer(
    (req, res) => {
      let raw = ''
      req.on('data', c => (raw += c))
      req.on('end', () => {
        body = JSON.parse(raw)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      })
    },
    baseUrl => send({ baseUrl, chatId: '42', text: 'hi', logger: quietLogger })
  )
  assert.equal(body.chat_id, '42')
  assert.equal(body.parse_mode, 'HTML')
})

test('a failed send surfaces rather than passing silently', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(400)
      res.end('bad chat id')
    },
    async baseUrl => {
      await assert.rejects(
        send({
          baseUrl,
          chatId: '42',
          text: 'hi',
          logger: quietLogger,
          attempts: 1
        }),
        /HTTP 400/
      )
    }
  )
})

test('dry run sends nothing and logs the exact text', async () => {
  const lines = []
  const r = await send({
    chatId: '42',
    text: 'hello',
    dryRun: true,
    logger: { ...quietLogger, info: (o, m) => lines.push({ ...o, m }) }
  })
  assert.equal(r.sent, false)
  assert.equal(lines[0].text, 'hello')
})

test('the probe confirms the bot identity rather than just a 200', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true,"result":{"username":"codex_watch_bot"}}')
    },
    async baseUrl => {
      const r = await probe({ baseUrl, logger: quietLogger })
      assert.equal(r.username, 'codex_watch_bot')
    }
  )
})

test('a 200 that does not confirm an identity reads as unhealthy', async () => {
  // Judge on the positive: an unrecognised shape must never read as fine.
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":false}')
    },
    async baseUrl => {
      await assert.rejects(
        probe({ baseUrl, logger: quietLogger, attempts: 1 }),
        /did not confirm/
      )
    }
  )
})
