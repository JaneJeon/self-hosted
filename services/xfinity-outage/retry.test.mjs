import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { backoffFor, httpError, isTransient, withRetry } from './retry.mjs'

// Collects the warn lines withRetry emits so tests can assert on them instead of
// printing to the test output.
function fakeLogger() {
  const warnings = []
  return { warnings, warn: (obj, msg) => warnings.push({ ...obj, msg }) }
}

const opts = (extra = {}) => ({ label: 'test', logger: fakeLogger(), ...extra })

test('isTransient: 5xx and network errors retry, 4xx does not', () => {
  assert.equal(isTransient(httpError('boom', 500)), true)
  assert.equal(isTransient(httpError('boom', 503)), true)
  assert.equal(isTransient(new Error('socket hang up')), true)
  assert.equal(isTransient(httpError('bad address', 400)), false)
  assert.equal(isTransient(httpError('unauthorized', 401)), false)
  assert.equal(isTransient(httpError('gone', 404)), false)
})

test('withRetry: returns immediately when the call succeeds', async () => {
  let calls = 0
  const result = await withRetry(async () => {
    calls++
    return 'ok'
  }, opts())
  assert.equal(result, 'ok')
  assert.equal(calls, 1)
})

test('withRetry: retries a transient 500 then succeeds', async () => {
  let calls = 0
  const logger = fakeLogger()
  const result = await withRetry(async () => {
    calls++
    if (calls < 3) throw httpError('Outage API returned HTTP 500', 500)
    return 'recovered'
  }, opts({ logger }))
  assert.equal(result, 'recovered')
  assert.equal(calls, 3)
  assert.equal(logger.warnings.length, 2)
  assert.equal(logger.warnings[0].msg, 'transient failure, retrying')
  assert.equal(logger.warnings[0].attempt, 1)
})

test('withRetry: exhausts attempts and rethrows the last error', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(
      async () => {
        calls++
        throw httpError('Outage API returned HTTP 500', 500)
      },
      opts({ attempts: 4 })
    ),
    /HTTP 500/
  )
  assert.equal(calls, 4)
})

test('withRetry: does not retry a 4xx', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(async () => {
      calls++
      throw httpError('Outage API returned HTTP 400', 400)
    }, opts()),
    /HTTP 400/
  )
  assert.equal(calls, 1)
})

// Exercises the real fetch -> httpError -> withRetry path over a socket, using
// the same error contract fetchOutageStatus applies in monitor.mjs. This is the
// failure that paged on-call: the upstream 500s, then recovers.
test('integration: retries a real HTTP 500 over the wire, then succeeds', async () => {
  let hits = 0
  const server = createServer((req, res) => {
    hits++
    if (hits <= 2) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(
        '{"error": {"errorCode": 500, "errorMessage": "internalerror: Error contacting backend"}}'
      )
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"outageInfoResponseList": []}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const logger = fakeLogger()

  try {
    const data = await withRetry(async () => {
      const resp = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(15_000)
      })
      if (!resp.ok)
        throw httpError(`Outage API returned HTTP ${resp.status}`, resp.status)
      return resp.json()
    }, opts({ logger }))

    assert.deepEqual(data, { outageInfoResponseList: [] })
    assert.equal(hits, 3, 'should have hit the server 3 times (500, 500, 200)')
    assert.equal(logger.warnings.length, 2)
    assert.match(logger.warnings[0].err.message, /HTTP 500/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('backoffFor: grows exponentially and stays within the jitter band', () => {
  for (const [attempt, min, max] of [
    [1, 500, 1500],
    [2, 1000, 3000],
    [3, 2000, 6000],
    [4, 4000, 12000]
  ]) {
    for (let i = 0; i < 50; i++) {
      const ms = backoffFor(attempt)
      assert.ok(
        ms >= min && ms <= max,
        `attempt ${attempt} produced ${ms}, expected ${min}-${max}`
      )
    }
  }
})
