import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fetchStatus, isTransientTrackerError } from './tracker.mjs'

const idle = readFileSync(
  new URL('./fixtures/status-idle.json', import.meta.url),
  'utf8'
)

// Exercises the real fetch path over a socket rather than stubbing it, which
// is how retry.test.mjs already tests this repo's HTTP handling.
async function withServer(handler, run) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    return await run(`http://127.0.0.1:${port}/`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

test('a 304 is a successful no-op, not an error', async () => {
  let seen = null
  await withServer(
    (req, res) => {
      seen = req.headers['if-none-match']
      res.writeHead(304)
      res.end()
    },
    async baseUrl => {
      const result = await fetchStatus({ baseUrl, etag: '"abc"' })
      assert.equal(result.notModified, true)
    }
  )
  assert.equal(seen, '"abc"', 'the stored etag must be sent as If-None-Match')
})

test('no stored etag means no conditional header', async () => {
  await withServer(
    (req, res) => {
      assert.equal(req.headers['if-none-match'], undefined)
      res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"e1"' })
      res.end(idle)
    },
    async baseUrl => {
      const result = await fetchStatus({ baseUrl })
      assert.equal(result.notModified, false)
      assert.equal(result.etag, '"e1"')
      assert.equal(result.data.latest_reset.id, 'observed-2097043464538264003')
    }
  )
})

test('a 429 is transient and carries its capped Retry-After', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(429, { 'Retry-After': '30' })
      res.end('{}')
    },
    async baseUrl => {
      const err = await fetchStatus({ baseUrl }).then(
        () => null,
        e => e
      )
      assert.ok(err)
      assert.equal(err.status, 429)
      assert.equal(err.retryAfterMs, 30_000)
      assert.equal(isTransientTrackerError(err), true)
    }
  )
})

test('a Retry-After beyond the cap is clamped', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(429, { 'Retry-After': '86400' })
      res.end('{}')
    },
    async baseUrl => {
      const err = await fetchStatus({ baseUrl }).catch(e => e)
      assert.equal(err.retryAfterMs, 60_000)
    }
  )
})

test('a 503 is transient', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(503)
      res.end('{}')
    },
    async baseUrl => {
      const err = await fetchStatus({ baseUrl }).catch(e => e)
      assert.equal(err.status, 503)
      assert.equal(isTransientTrackerError(err), true)
    }
  )
})

test('a 404 is not transient, because the contract changed', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(404)
      res.end('{}')
    },
    async baseUrl => {
      const err = await fetchStatus({ baseUrl }).catch(e => e)
      assert.equal(isTransientTrackerError(err), false)
    }
  )
})

test('a renamed or missing field fails loudly instead of reading as absent', async () => {
  // An absent signal and a signal we can no longer parse look identical
  // downstream, and one of them clears the calendar.
  const cases = [
    [
      '{"meta":{"api_version":"v1"},"data":{"latest_reset":null,"scheduled_reset":null,"active_watch":null}}',
      /missing data.stats/
    ],
    [
      '{"meta":{"api_version":"v2"},"data":{"latest_reset":null,"scheduled_reset":null,"active_watch":null,"stats":{}}}',
      /version changed/
    ],
    ['{"meta":{"api_version":"v1"}}', /missing data or meta/]
  ]
  for (const [body, expected] of cases) {
    await withServer(
      (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(body)
      },
      async baseUrl => {
        await assert.rejects(fetchStatus({ baseUrl }), expected)
      }
    )
  }
})
