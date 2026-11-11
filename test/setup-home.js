/**
 * Keep every test run away from the real DSH home. Each test file runs in its
 * own process and imports this module first, so it gets a fresh, empty
 * DSH_HOME before src/constants.js reads it.
 *
 * An inherited DSH_HOME is never trusted: shells started from a running DSH
 * carry DSH_HOME=<the live home>, so a test file run there directly with
 * `node --test` would otherwise delete or overwrite the live bot's
 * sent-messages.json, stickers.json, state.json and topics.json.
 *
 * Temporary files the tests make (os.tmpdir() reads TMPDIR on every call) go
 * below the same directory, which is removed when the process exits.
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-telegram-test-home-'))
const scratch = join(home, 'tmp')
mkdirSync(scratch)
process.env.DSH_HOME = home
process.env.TMPDIR = scratch
process.on('exit', () => rmSync(home, { recursive: true, force: true }))
