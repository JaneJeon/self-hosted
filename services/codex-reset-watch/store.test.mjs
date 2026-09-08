import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileStore } from './store.mjs'

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} }
const scratch = () => mkdtempSync(join(tmpdir(), 'codex-reset-watch-'))

test('a missing state file is a first run, not an error', () => {
  const store = createFileStore(join(scratch(), 'last_state.json'), {
    logger: quietLogger
  })
  assert.equal(store.load(), null)
})

test('a corrupt state file warns and reads as a first run', () => {
  const dir = scratch()
  const path = join(dir, 'last_state.json')
  writeFileSync(path, '{not json', 'utf8')
  const warnings = []
  const store = createFileStore(path, {
    logger: { ...quietLogger, warn: (o, m) => warnings.push(m) }
  })
  assert.equal(store.load(), null)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /treating as first run/)
})

test('a save leaves no temporary file behind', () => {
  const dir = scratch()
  const path = join(dir, 'last_state.json')
  const store = createFileStore(path, { logger: quietLogger })
  store.save({ version: 1, signal: null })
  assert.deepEqual(
    readdirSync(dir),
    ['last_state.json'],
    'the tmp file must be renamed away'
  )
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
    version: 1,
    signal: null
  })
})

test('a save into a directory that does not exist yet still works', () => {
  const path = join(scratch(), 'nested', 'deeper', 'last_state.json')
  const store = createFileStore(path, { logger: quietLogger })
  store.save({ version: 1 })
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, 1)
})

test('a round trip preserves the state exactly', () => {
  const path = join(scratch(), 'last_state.json')
  const store = createFileStore(path, { logger: quietLogger })
  const state = {
    version: 1,
    trackerEtag: '"abc"',
    signal: { kind: 'watch', windowStartUtc: '2026-09-08T01:00:00.000Z' },
    projection: null,
    health: { ok: true }
  }
  store.save(state)
  assert.deepEqual(store.load(), state)
})
