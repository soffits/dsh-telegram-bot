import './setup-home.js'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const testDir = dirname(fileURLToPath(import.meta.url))

test('a test process started with a live DSH_HOME never sees or changes it', async () => {
  // A shell opened by a running DSH carries DSH_HOME=<live home>; running one
  // test file there directly must not reach the live Telegram files.
  const live = await mkdtemp(join(tmpdir(), 'live-home-'))
  try {
    const liveTelegram = join(live, 'telegram')
    await mkdir(liveTelegram)
    await writeFile(join(liveTelegram, 'sent-messages.json'), '{"version":1,"entries":[]}\n')
    const probe = [
      `await import(${JSON.stringify(pathToFileURL(join(testDir, 'setup-home.js')).href)})`,
      `const { STATUS_DIR } = await import(${JSON.stringify(pathToFileURL(join(testDir, '..', 'src', 'constants.js')).href)})`,
      `const { SENT_LOG_PATH } = await import(${JSON.stringify(pathToFileURL(join(testDir, '..', 'src', 'sent-log.js')).href)})`,
      `const { tmpdir } = await import('node:os')`,
      'console.log(JSON.stringify({ home: process.env.DSH_HOME, status: STATUS_DIR, sentLog: SENT_LOG_PATH, tmp: tmpdir() }))',
    ].join('\n')
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', probe], { env: { ...process.env, DSH_HOME: live } })
    const seen = JSON.parse(stdout)
    assert.notEqual(seen.home, live)
    for (const path of [seen.status, seen.sentLog, seen.tmp]) assert.ok(path.startsWith(seen.home + '/'), path)
    // The temporary home is removed when the process exits.
    assert.equal(existsSync(seen.home), false)
    assert.deepEqual(await readdir(liveTelegram), ['sent-messages.json'])
    assert.equal(await readFile(join(liveTelegram, 'sent-messages.json'), 'utf8'), '{"version":1,"entries":[]}\n')
  } finally {
    await rm(live, { recursive: true, force: true })
  }
})

test('every test file loads setup-home before anything else', async () => {
  const files = (await readdir(testDir)).filter((name) => name.endsWith('.test.js'))
  assert.ok(files.length > 0)
  for (const name of files) {
    const first = (await readFile(join(testDir, name), 'utf8')).split('\n', 1)[0]
    assert.equal(first, "import './setup-home.js'", name)
  }
})
