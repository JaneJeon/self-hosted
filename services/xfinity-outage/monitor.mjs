import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  accessSync,
  constants
} from 'node:fs'
import { dirname } from 'node:path'
import pino from 'pino'
import { httpError, withRetry } from './retry.mjs'
import { buildMessage, detectChanges, extractState } from './changes.mjs'

const logger = pino()

const STATE_PATH = '/data/last_state.json'
const XFINITY_ORIGIN = 'https://www.xfinity.com'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// The Xfinity API intermittently fails with HTTP 500 "Error contacting backend".
// Those failures hang ~11-20s while healthy calls return in ~2s, so cap each
// attempt to keep a slow upstream from stalling the run. Retry policy: retry.mjs.
const HTTP_TIMEOUT_MS = 15_000

// Store interface: { load(): State|null, save(State): void }
// Swap this out for a MySQLStore or similar when needed.
function createFileStore(path) {
  return {
    load() {
      if (!existsSync(path)) return null
      try {
        return JSON.parse(readFileSync(path, 'utf8'))
      } catch (e) {
        logger.warn(
          { err: e },
          'could not parse state file, treating as first run'
        )
        return null
      }
    },
    save(state) {
      mkdirSync(dirname(path), { recursive: true })
      const tmp = path + '.tmp'
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
      renameSync(tmp, path) // atomic on unix
    }
  }
}

function requireEnv(name) {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

async function getSessionToken() {
  const resp = await fetch('https://api.sc.xfinity.com/outagedata/session', {
    method: 'POST',
    headers: {
      'Content-Length': '0',
      Origin: XFINITY_ORIGIN,
      Referer: XFINITY_ORIGIN + '/',
      'User-Agent': UA
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
  })
  if (resp.status !== 201)
    throw httpError(`Session API returned HTTP ${resp.status}`, resp.status)
  const token = resp.headers.get('X-OutageDataService-Token')
  if (!token) throw new Error('No token in session response headers')
  return token
}

async function fetchOutageStatus(token, address) {
  const url =
    `https://api.sc.xfinity.com/outage/consolidated/lob/v3` +
    `?includeIdealOutage=true&tokenizeDateTime=true&address=${address}`
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: XFINITY_ORIGIN,
      Referer: XFINITY_ORIGIN + '/',
      'User-Agent': UA
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
  })
  if (!resp.ok)
    throw httpError(`Outage API returned HTTP ${resp.status}`, resp.status)
  return resp.json()
}

async function sendTelegram(token, chatId, text) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`Telegram API returned HTTP ${resp.status}: ${body}`)
  }
}

async function main() {
  logger.info('starting')

  const dataDir = dirname(STATE_PATH)
  const dataDirExists = existsSync(dataDir)
  logger.info(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      stateDir: dataDir,
      stateDirExists: dataDirExists,
      stateDirWritable: dataDirExists
        ? (() => {
            try {
              accessSync(dataDir, constants.W_OK)
              return true
            } catch {
              return false
            }
          })()
        : false,
      env: {
        HOME_ADDRESS: !!process.env.HOME_ADDRESS,
        TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID: !!process.env.TELEGRAM_CHAT_ID,
        HEARTBEAT_URL: !!process.env.HEARTBEAT_URL
      }
    },
    'diagnostics'
  )

  const address = requireEnv('HOME_ADDRESS')
  const tgToken = requireEnv('TELEGRAM_BOT_TOKEN')
  const tgChatId = requireEnv('TELEGRAM_CHAT_ID')
  const heartbeatUrl = process.env.HEARTBEAT_URL

  const store = createFileStore(STATE_PATH)

  const token = await withRetry(getSessionToken, { label: 'session', logger })
  logger.info('session token obtained')

  const data = await withRetry(() => fetchOutageStatus(token, address), {
    label: 'outage status',
    logger
  })
  const newState = extractState(data)
  // customerMessage is logged whole because the API is undocumented: on
  // 2026-10-19 the estimate went null one check before the outage cleared,
  // and nothing recorded what else the message said at that moment.
  logger.info(
    {
      hasOutage: newState.hasOutage,
      outageType: newState.outageType,
      customerMessage: data.customerMessage ?? null
    },
    'outage status'
  )

  const oldState = store.load()
  const changes = detectChanges(oldState, newState)

  // Built only when something changed, so a malformed field can break at
  // most the run that has news, not every quiet 15-minute check.
  const msg = changes.length > 0 ? buildMessage(changes, newState) : ''
  if (msg) {
    await sendTelegram(tgToken, tgChatId, msg)
    logger.info({ changes: changes.map(c => c.type) }, 'notification sent')
  } else if (changes.length > 0) {
    // Some changes (a dropped restore estimate) are recorded but not sent.
    logger.info({ changes }, 'change recorded, nothing to notify')
  } else {
    logger.info('no change detected')
  }

  store.save(newState)

  // The outage check is done and the state is saved by this point, so a failed
  // heartbeat is a monitoring fault, not a failed run. Reporting it as an
  // unhandled error made a broken HEARTBEAT_URL look identical to a broken
  // outage check. Retry, then record it and keep the exit code non-zero so
  // Railway still surfaces it.
  if (heartbeatUrl) {
    try {
      await withRetry(
        async () => {
          const resp = await fetch(heartbeatUrl, {
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
          })
          if (!resp.ok)
            throw httpError(
              `Heartbeat returned HTTP ${resp.status}`,
              resp.status
            )
        },
        // Everything is retried here, 4xx included. Uptime Kuma returns 404
        // while it is restarting a monitor, so a 404 is not proof the monitor
        // is gone. A wasted retry on a fire-and-forget ping costs nothing.
        { label: 'heartbeat', logger, transient: () => true }
      )
      logger.info('heartbeat sent')
    } catch (err) {
      logger.error(
        { err },
        'heartbeat failed - watchdog is blind, check HEARTBEAT_URL'
      )
      process.exitCode = 1
    }
  }

  logger.info('done')
}

main().catch(err => {
  logger.fatal({ err }, 'unhandled error')
  process.exit(1)
})
