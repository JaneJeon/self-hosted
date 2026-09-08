import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync
} from 'node:fs'
import { dirname } from 'node:path'

// The state file lives on the Railway volume. It is the only thing that
// survives between cron runs, so every transition decision is made by
// comparing the tracker's current answer against what is stored here.
export const STATE_PATH = '/data/last_state.json'

export const STATE_VERSION = 1

// Store interface: { load(): State|null, save(State): void }
// Lifted out of the entrypoint (where xfinity-outage keeps it inline) so the
// corrupted-state test can assert on the warning it logs. The logger is
// injected for the same reason.
export function createFileStore(path, { logger }) {
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
