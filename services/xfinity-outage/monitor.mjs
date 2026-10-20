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
import {
  BUILDING_OFF,
  attachBuilding,
  buildingQuery,
  homeOutageIds,
  neighborError,
  neighborParam,
  neighborResult,
  pickNeighbors,
  summarizeBuilding
} from './building.mjs'

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

// Parses a JSON body without ever quoting it: a parse error's message quotes
// the body, and Xfinity's bodies can name an address.
async function readJson(resp, label) {
  const text = await resp.text()
  try {
    return JSON.parse(text)
  } catch {
    const err = new Error(
      `${label} returned a body that is not JSON (${text.length} bytes)`
    )
    err.name = 'NonJsonBody'
    throw err
  }
}

async function fetchOutageStatus(token, address, timeoutMs = HTTP_TIMEOUT_MS) {
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
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!resp.ok)
    throw httpError(`Outage API returned HTTP ${resp.status}`, resp.status)
  return readJson(resp, 'Outage API')
}

async function fetchTypeahead(token, query, timeoutMs) {
  const url =
    `https://api.sc.xfinity.com/address/typeahead` +
    `?address=${encodeURIComponent(query)}&origins=eloc&tokenized=false`
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: XFINITY_ORIGIN,
      Referer: XFINITY_ORIGIN + '/',
      'User-Agent': UA
    },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!resp.ok)
    throw httpError(`Typeahead API returned HTTP ${resp.status}`, resp.status)
  return readJson(resp, 'Typeahead API')
}

// The whole building check gets one 20-second budget, one attempt per call,
// each call cut off at whatever budget is left. It runs before the state
// save and the heartbeat, and the Kuma window leaves 60 seconds of slack over
// the 15-minute cron, so it must never push the heartbeat late.
const BUILDING_BUDGET_MS = 20_000

// Returns a building summary, BUILDING_OFF when the home address has no
// unit, or null with a logged reason when this run gives no evidence.
async function checkBuilding(token, homeAddress, homeIds) {
  const query = buildingQuery(homeAddress)
  if (!query) return BUILDING_OFF
  const deadline = Date.now() + BUILDING_BUDGET_MS
  const left = () => Math.min(HTTP_TIMEOUT_MS, deadline - Date.now())

  let typeahead
  try {
    typeahead = await fetchTypeahead(token, query, Math.max(1, left()))
  } catch (err) {
    logger.warn(
      { reason: err.status ?? err.name },
      'building check: typeahead failed'
    )
    return null
  }
  const neighbors = pickNeighbors(typeahead, homeAddress)
  const results = []
  for (const neighbor of neighbors) {
    if (left() <= 0) {
      results.push({ status: 'error', reason: 'budget' })
      break
    }
    try {
      const data = await fetchOutageStatus(
        token,
        neighborParam(neighbor),
        Math.max(1, left())
      )
      results.push(neighborResult(data))
    } catch (err) {
      results.push(neighborError(err))
    }
  }
  const summary = summarizeBuilding(results, homeIds)
  const tally = {}
  for (const r of results) {
    const key = r.status === 'error' ? `error:${r.reason}` : r.status
    tally[key] = (tally[key] ?? 0) + 1
  }
  if (!summary)
    logger.warn(
      { picked: neighbors.length, tally },
      'building check: no evidence this run'
    )
  else
    logger.info(
      { picked: neighbors.length, tally, building: summary },
      'building check'
    )
  return summary
}

async function sendTelegram(token, chatId, text) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    // Without a limit a hung send would hold the state save and heartbeat.
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
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
  const homeState = extractState(data)
  const homeIds = homeOutageIds(data)
  // customerMessage is logged because the API is undocumented, so the logs
  // show what Xfinity said at each check, for example when it drops an
  // estimate. Its free-text `messages` is left out: it names the street
  // address ("Your Xfinity services at <street> may be unavailable"), which
  // this service otherwise keeps out of its logs.
  const { messages, ...loggableMessage } = data.customerMessage ?? {}
  logger.info(
    {
      hasOutage: homeState.hasOutage,
      outageType: homeState.outageType,
      customerMessage: data.customerMessage ? loggableMessage : null
    },
    'outage status'
  )

  // Neighbor addresses never reach the logs or the state file, only counts
  // and outage IDs. A failure here leaves the home check untouched.
  let building = null
  try {
    building = await checkBuilding(token, address, homeIds)
  } catch (err) {
    // Only the error's type: its message could quote a body.
    logger.warn(
      { reason: err?.name },
      'building check failed, keeping the previous result'
    )
  }

  const oldState = store.load()
  const newState = attachBuilding(oldState, homeState, building, homeIds)
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
