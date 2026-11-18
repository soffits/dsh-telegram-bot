/**
 * Action buttons: inline buttons a sender attaches to a topic send, whose
 * press becomes an event for the scheduler (dsh-cron-jobs) carrying who
 * pressed. The bot keeps what each button stands for here, so a press works
 * hours later and after a restart; the message itself carries only a short
 * token. A set of buttons settles once: the first accepted press, or the
 * first press after it expired, replaces the buttons with the outcome.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { STATUS_DIR } from './constants.js'

export const ACTIONS_PATH = join(STATUS_DIR, 'actions.json')
/** Callback data prefix: `x:<token>:<button index>` (Telegram allows 64 bytes). */
export const ACTION_PREFIX = 'x'
export const MAX_BUTTONS = 8
const ID = /^[A-Za-z0-9_-]{1,32}$/u
const CHANNEL = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/u
const MAX_LABEL = 40
const MAX_DATA_BYTES = 4096
/** Settled or expired sets are kept this long, so a late press still gets a clear answer. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Check a send's `actions` (`{ buttons: [{ id, label }], event, data?, users?, expires? }`).
 * @returns the cleaned set, with `expires` as epoch milliseconds.
 * @throws Error saying what is wrong.
 */
export function checkActions(input) {
  if (input === null || typeof input !== 'object') throw new Error('actions must be an object with buttons and an event.')
  const buttons = Array.isArray(input.buttons) ? input.buttons : []
  if (buttons.length === 0 || buttons.length > MAX_BUTTONS) throw new Error(`actions need 1 to ${MAX_BUTTONS} buttons.`)
  const seen = new Set()
  const clean = buttons.map((button) => {
    const id = String(button?.id ?? '')
    const label = String(button?.label ?? '').trim()
    if (!ID.test(id)) throw new Error(`Button id ${JSON.stringify(id)} must be 1 to 32 letters, digits, - or _.`)
    if (seen.has(id)) throw new Error(`Button id ${id} is given twice.`)
    if (label.length === 0 || label.length > MAX_LABEL) throw new Error(`Button ${id} needs a label of 1 to ${MAX_LABEL} characters.`)
    seen.add(id)
    return { id, label }
  })
  const event = String(input.event ?? '')
  if (!CHANNEL.test(event) || event.length > 200) throw new Error(`Action event ${JSON.stringify(event)} is not a channel name (dot-separated words).`)
  const data = input.data ?? {}
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('Action data must be a JSON object.')
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_DATA_BYTES) throw new Error(`Action data is over ${MAX_DATA_BYTES} bytes.`)
  const users = (Array.isArray(input.users) ? input.users : []).map(String)
  if (users.some((user) => !/^\d+$/u.test(user))) throw new Error('Action users are numeric Telegram user ids.')
  let expires
  if (input.expires !== undefined && input.expires !== null) {
    expires = typeof input.expires === 'number' ? input.expires : Date.parse(String(input.expires))
    if (!Number.isFinite(expires)) throw new Error(`Action expiry ${JSON.stringify(input.expires)} is not a time.`)
  }
  return { buttons: clean, event, data, users, ...(expires === undefined ? {} : { expires }) }
}

/** The inline keyboard for a set: short labels side by side, longer ones one per row. */
export function actionKeyboard(token, buttons) {
  const keys = buttons.map((button, index) => ({ text: button.label, callback_data: `${ACTION_PREFIX}:${token}:${index}` }))
  const narrow = keys.length <= 3 && buttons.every((button) => button.label.length <= 16)
  return narrow ? [keys] : keys.map((key) => [key])
}

/** The keyboard once a set is settled: one button that only says what happened. */
export function outcomeKeyboard(token, text) {
  return [[{ text, callback_data: `${ACTION_PREFIX}:${token}:-` }]]
}

/**
 * Parse `x:<token>:<index>` callback data.
 * @returns `{ token, index }` (index undefined for the outcome button), or undefined.
 */
export function parseActionData(ref) {
  const [token, index] = String(ref).split(':')
  if (!/^[0-9a-f]{12}$/u.test(token ?? '')) return undefined
  return { token, index: /^\d+$/u.test(index ?? '') ? Number(index) : undefined }
}

/**
 * The event a press becomes: the sender's data, the button pressed, who
 * pressed it (a channel principal, as dsh-message-context names senders) and
 * which message it was.
 */
export function pressEvent(entry, button, principal, at) {
  return {
    ...entry.data,
    action: button.id,
    label: button.label,
    by: principal,
    message: { chatId: entry.chatId, threadId: entry.threadId, messageId: entry.messageId },
    at: new Date(at).toISOString(),
  }
}

/**
 * The store of sent sets, one JSON file under the bot's state folder.
 * @param options.path - file.
 * @param options.now - clock, for tests.
 * @returns `{ token, add, get, settle }`.
 */
export function createActionStore({ path = ACTIONS_PATH, now = Date.now } = {}) {
  let entries
  let writing = Promise.resolve()

  async function load() {
    if (entries !== undefined) return entries
    try {
      const data = JSON.parse(await readFile(path, 'utf8'))
      entries = data !== null && typeof data?.entries === 'object' ? data.entries : {}
    } catch {
      entries = {}
    }
    return entries
  }

  function save() {
    const oldest = now() - KEEP_MS
    for (const [token, entry] of Object.entries(entries)) {
      const ended = Math.max(entry.settled?.at ?? entry.expires ?? Infinity, entry.createdAt ?? 0)
      if (ended < oldest) delete entries[token]
    }
    const body = `${JSON.stringify({ version: 1, entries }, null, 1)}\n`
    writing = writing.catch(() => {}).then(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, body, { mode: 0o600 })
      await rename(temporary, path)
    })
    return writing
  }

  return {
    /** A fresh token for a set about to be sent. */
    token: () => randomBytes(6).toString('hex'),
    /** Remember a sent set under its token. */
    async add(token, entry) {
      await load()
      entries[token] = { ...entry, createdAt: now() }
      await save()
    },
    async get(token) {
      return (await load())[token]
    },
    /** Mark a set settled; returns false when it already was. */
    async settle(token, outcome) {
      const entry = (await load())[token]
      if (entry === undefined || entry.settled !== undefined) return false
      entry.settled = { ...outcome, at: now() }
      await save()
      return true
    },
  }
}
