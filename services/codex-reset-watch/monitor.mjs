import pino from 'pino'
import { createFileStore, STATE_PATH } from './store.mjs'
import { createCalDavClient, extractAlarms } from './caldav.mjs'
import { probe, send } from './telegram.mjs'
import { diagnostics, HEARTBEAT_VARS, requireEnv, run } from './run.mjs'

const logger = pino()

async function main() {
  logger.info('starting')
  logger.info(
    diagnostics([
      'CALDAV_USERNAME',
      'CALDAV_PASSWORD',
      'CALDAV_CALENDAR_URL',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_CHAT_ID',
      ...Object.values(HEARTBEAT_VARS),
      'DRY_RUN'
    ]),
    'diagnostics'
  )

  const dryRun = !!process.env.DRY_RUN
  if (dryRun)
    logger.warn('DRY_RUN is set: no calendar or telegram writes will be made')

  const calendarUrl = requireEnv('CALDAV_CALENDAR_URL')
  const username = requireEnv('CALDAV_USERNAME')
  const password = requireEnv('CALDAV_PASSWORD')
  const tgToken = requireEnv('TELEGRAM_BOT_TOKEN')
  const tgChatId = requireEnv('TELEGRAM_CHAT_ID')

  const client = createCalDavClient({
    calendarUrl,
    username,
    password,
    logger,
    dryRun
  })

  await run({
    logger,
    store: createFileStore(STATE_PATH, { logger }),
    caldav: {
      ourHref: client.ourHref,
      sweep: () => client.sweep(),
      put: (projection, opts) => client.put(projection, opts),
      remove: target => client.remove(target),
      // Read the live body so any reminder Jane added by hand survives the
      // whole-resource rewrite.
      alarmsFor: async entry =>
        extractAlarms(entry.ics ?? (await client.get(entry.href))?.ics)
    },
    telegram: {
      probe: () => probe({ token: tgToken, logger }),
      send: text =>
        send({ token: tgToken, chatId: tgChatId, text, dryRun, logger })
    },
    dryRun
  })

  logger.info('done')
}

main().catch(err => {
  logger.fatal({ err }, 'unhandled error')
  process.exit(1)
})
