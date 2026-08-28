// Retry helpers, kept separate from monitor.mjs so they can be imported by
// tests without running a real monitor pass.

export const RETRY_ATTEMPTS = 5

export function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// A 4xx means the address or API contract changed — retrying cannot fix that,
// so it should surface. Everything else (5xx, timeouts, socket errors) is
// treated as transient.
export function isTransient(err) {
  return err.status === undefined || err.status >= 500
}

// 1s, 2s, 4s, 8s with 50-150% jitter.
export function backoffFor(attempt) {
  return Math.round(2 ** (attempt - 1) * 1000 * (0.5 + Math.random()))
}

export async function withRetry(
  fn,
  { label, logger, attempts = RETRY_ATTEMPTS }
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= attempts || !isTransient(err)) throw err
      const backoff = backoffFor(attempt)
      logger.warn(
        { err, label, attempt, attempts, backoff },
        'transient failure, retrying'
      )
      await sleep(backoff)
    }
  }
}
