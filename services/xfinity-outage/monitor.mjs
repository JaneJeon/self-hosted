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

const STATE_PATH = '/data/last_state.json'
const XFINITY_ORIGIN = 'https://www.xfinity.com'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Store interface: { load(): State|null, save(State): void }
// Swap this out for a MySQLStore or similar when needed.
function createFileStore(path) {
  return {
    load() {
      if (!existsSync(path)) return null
      try {
        return JSON.parse(readFileSync(path, 'utf8'))
      } catch (e) {
        log(
          `Warning: could not parse state file, treating as first run (${e.message})`
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

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
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
    }
  })
  if (resp.status !== 201)
    throw new Error(`Session API returned HTTP ${resp.status}`)
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
    }
  })
  if (!resp.ok) throw new Error(`Outage API returned HTTP ${resp.status}`)
  return resp.json()
}

function extractState(data) {
  const outages = data.outageInfoResponseList ?? []
  const msg = data.customerMessage ?? null

  if (!outages.length || !msg) {
    return {
      hasOutage: false,
      outageId: null,
      outageType: null,
      planned: null,
      services: null,
      startTime: null,
      etr: null,
      etrDisplay: null,
      shortDescription: null,
      impactStyle: null,
      customerFacingText: null,
      checkedAt: new Date().toISOString()
    }
  }

  const outage = outages[0]
  return {
    hasOutage: true,
    outageId: outage.outageId,
    outageType: msg.outageType ?? null,
    planned: msg.planned ?? false,
    services: outage.services ?? [],
    startTime: outage.startTime?.iso ?? null,
    etr: msg.etr?.iso ?? null,
    etrDisplay: msg.etrOutputString ?? null,
    shortDescription: msg.messages?.shortDescription ?? null,
    impactStyle: msg.impactStyle ?? null,
    customerFacingText: msg.customerFacingText ?? null,
    checkedAt: new Date().toISOString()
  }
}

function detectChanges(old, next) {
  if (!old) return next.hasOutage ? [{ type: 'new_outage' }] : []
  if (!old.hasOutage && next.hasOutage) return [{ type: 'new_outage' }]
  if (old.hasOutage && !next.hasOutage)
    return [{ type: 'resolved', startTime: old.startTime }]
  if (old.outageId !== next.outageId) return [{ type: 'new_outage' }]

  const changes = []
  if (old.etr !== next.etr) {
    const pushed = new Date(next.etr ?? 0) > new Date(old.etr ?? 0)
    changes.push({
      type: pushed ? 'etr_pushed' : 'etr_earlier',
      oldEtr: old.etrDisplay ?? old.etr,
      newEtr: next.etrDisplay ?? next.etr
    })
  }
  if (old.outageType !== next.outageType) {
    changes.push({
      type: 'type_changed',
      oldType: old.outageType,
      newType: next.outageType
    })
  }
  return changes
}

// Displays time in Pacific — this service monitors a California address.
function formatTime(isoString) {
  if (!isoString) return 'unknown time'
  return new Date(isoString).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  })
}

function timeSince(isoString) {
  const mins = Math.round((Date.now() - new Date(isoString).getTime()) / 60_000)
  if (mins < 60) return `~${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `~${h}h ${m}m` : `~${h}h`
}

function buildMessage(changes, state) {
  const parts = []

  for (const c of changes) {
    const svc = (state.services ?? ['Internet']).join(', ')
    const etr = state.etrDisplay ?? formatTime(state.etr)

    if (c.type === 'new_outage') {
      const since = formatTime(state.startTime)
      const upcoming =
        state.startTime && new Date(state.startTime).getTime() > Date.now()
      if (state.planned && upcoming) {
        parts.push(
          `<b>Xfinity: Planned maintenance scheduled</b>\n\n` +
            `Xfinity has scheduled maintenance that may affect your ${svc} service.\n` +
            `Window: ${since} – ${etr}.`
        )
      } else if (state.planned) {
        parts.push(
          `<b>Xfinity: Internet is down (planned maintenance)</b>\n\n` +
            `Your internet went down at ${since}.\n` +
            `Xfinity is doing scheduled network maintenance and expects to restore service by ${etr}.`
        )
      } else {
        parts.push(
          `<b>Xfinity: Internet is down</b>\n\n` +
            `An unplanned outage started at ${since} affecting ${svc} service.\n` +
            `Xfinity estimates restoration by ${etr}.`
        )
      }
    } else if (c.type === 'resolved') {
      const downtime = c.startTime ? timeSince(c.startTime) : null
      parts.push(
        `<b>Xfinity: Internet is back</b>\n\n` +
          `The outage has been resolved.` +
          (downtime ? ` Total downtime: ${downtime}.` : '')
      )
    } else if (c.type === 'etr_pushed') {
      const since = formatTime(state.startTime)
      const label = state.planned ? ' (planned maintenance)' : ''
      parts.push(
        `<b>Xfinity: Outage ETA pushed back</b>\n\n` +
          `Estimated restore changed: ${c.oldEtr} → ${c.newEtr}.\n` +
          `Internet still down since ${since}${label}.`
      )
    } else if (c.type === 'etr_earlier') {
      const since = formatTime(state.startTime)
      const label = state.planned ? ' (planned maintenance)' : ''
      parts.push(
        `<b>Xfinity: Outage ETA moved up</b>\n\n` +
          `Estimated restore changed: ${c.oldEtr} → ${c.newEtr}.\n` +
          `Internet still down since ${since}${label}.`
      )
    } else if (c.type === 'type_changed') {
      const since = formatTime(state.startTime)
      parts.push(
        `<b>Xfinity: Outage reclassified</b>\n\n` +
          `Previously reported as ${c.oldType}, now listed as ${c.newType}.\n` +
          `Internet still down since ${since}. ETA: ${etr}.`
      )
    }
  }

  return parts.join('\n\n')
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
  log('=== Xfinity outage check starting ===')
  log(`Node ${process.version} on ${process.platform}/${process.arch}`)

  const envKeys = [
    'HOME_ADDRESS',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'UPTIME_KUMA_PUSH_URL'
  ]
  for (const k of envKeys)
    log(`env ${k}: ${process.env[k] ? 'set' : 'MISSING'}`)

  const dataDir = dirname(STATE_PATH)
  const dataDirExists = existsSync(dataDir)
  let dataDirWritable = false
  if (dataDirExists) {
    try {
      accessSync(dataDir, constants.W_OK)
      dataDirWritable = true
    } catch {}
  }
  log(
    `state dir ${dataDir}: exists=${dataDirExists} writable=${dataDirWritable}`
  )

  const address = requireEnv('HOME_ADDRESS')
  const tgToken = requireEnv('TELEGRAM_BOT_TOKEN')
  const tgChatId = requireEnv('TELEGRAM_CHAT_ID')
  const heartbeatUrl = process.env.UPTIME_KUMA_PUSH_URL

  const store = createFileStore(STATE_PATH)

  const token = await getSessionToken()
  log('Session token obtained')

  const data = await fetchOutageStatus(token, address)
  const newState = extractState(data)
  log(
    `Outage status: ${
      newState.hasOutage ? `YES — ${newState.outageType}` : 'none'
    }`
  )

  const oldState = store.load()
  const changes = detectChanges(oldState, newState)

  if (changes.length > 0) {
    const msg = buildMessage(changes, newState)
    await sendTelegram(tgToken, tgChatId, msg)
    log(`Notification sent: ${changes.map(c => c.type).join(', ')}`)
  } else {
    log('No change detected')
  }

  store.save(newState)

  if (heartbeatUrl) {
    const resp = await fetch(heartbeatUrl)
    if (!resp.ok) throw new Error(`Heartbeat returned HTTP ${resp.status}`)
    log('Heartbeat sent')
  }

  log('=== Xfinity outage check complete ===')
}

main().catch(err => {
  console.error(`[${new Date().toISOString()}] FATAL: ${err.message}`)
  process.exit(1)
})
