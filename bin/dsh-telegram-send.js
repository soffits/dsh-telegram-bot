#!/usr/bin/env node
/**
 * Send a message into a topic of the running DSH Telegram bot.
 *
 * The request goes through the plugin's file spool under $DSH_HOME/telegram,
 * so it needs no bot token, and it waits there while DSH is not running.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { enqueue, waitForResult } from '../src/outbox.js'

const usage = `Usage: dsh-telegram-send --thread <thread-id> [--chat <chat-id>] [--file <path>]...
                         [--job <name>] [--from-session <id>] [--from <label>]
                         [--format markdown|html|plain] [--silent] [--voice]
                         [--action <id>=<label>... --action-event <channel>
                          [--action-data <json>] [--action-user <id>]...
                          [--action-expires <time>]]
                         [--no-wait] [--timeout <seconds>] [text...]

Sends text (from the arguments, or from stdin when none are given) and files
into a topic of the running DSH Telegram bot, addressed by its numeric thread
id (/id in the topic shows it). The message is also recorded in the session
bound to that topic, without starting a turn. Long text is split into several
Telegram messages. Files are shown by type: pictures inline, GIFs as
animations, audio and video in Telegram's players, anything else as a document.

  --chat <id>            chat to send to; only needed when several chats have a
                         topic with that thread id (the bot otherwise uses the
                         chat it saw the thread in)
  --job <name>           name of the job or script sending it
  --from-session <id>    DSH session sending it; defaults to $DSH_SESSION_ID
                         (set inside DSH sessions), --from-session '' for none
  --from <label>         free-form sender label, used when neither is given
  --format <format>      how the text is written: markdown (default, converted
                         for Telegram), html (Telegram HTML) or plain
  --silent               deliver without a notification sound
  --voice                send Opus/Ogg audio files as voice messages
  --action <id>=<label>  a button under the text (repeatable, up to 8); a press
                         is emitted as --action-event for dsh-cron-jobs with the
                         --action-data object, the button's id as "action", its
                         label, who pressed ("by", a telegram-user principal) and
                         the message; the buttons then show the outcome
  --action-event <name>  the event channel a press is emitted on
  --action-data <json>   a JSON object the event carries
  --action-user <id>     only this Telegram user may press (repeatable)
  --action-expires <t>   ISO time after which a press only marks it expired

Exit codes: 0 sent, 1 failed (for example an unknown thread id), 2 bad arguments,
3 still queued after the timeout (the bot sends it once it runs).`

let options
try {
  options = parseArgs({
    allowPositionals: true,
    options: {
      thread: { type: 'string', short: 't' },
      chat: { type: 'string', short: 'c' },
      file: { type: 'string', short: 'f', multiple: true },
      from: { type: 'string' },
      job: { type: 'string', short: 'j' },
      'from-session': { type: 'string' },
      format: { type: 'string' },
      silent: { type: 'boolean' },
      voice: { type: 'boolean' },
      action: { type: 'string', multiple: true },
      'action-event': { type: 'string' },
      'action-data': { type: 'string' },
      'action-user': { type: 'string', multiple: true },
      'action-expires': { type: 'string' },
      'no-wait': { type: 'boolean' },
      timeout: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
} catch (error) {
  process.stderr.write(`${error.message}\n\n${usage}\n`)
  process.exit(2)
}
const { values, positionals } = options
if (values.help) {
  process.stdout.write(`${usage}\n`)
  process.exit(0)
}
if (values.thread === undefined || !/^\d+$/u.test(values.thread.trim())) {
  process.stderr.write(`--thread takes the topic's numeric thread id.\n\n${usage}\n`)
  process.exit(2)
}
if (values.chat !== undefined && !/^-?\d+$/u.test(values.chat.trim())) {
  process.stderr.write(`--chat takes a numeric chat id.\n\n${usage}\n`)
  process.exit(2)
}

const FORMATS = ['markdown', 'html', 'plain']
if (values.format !== undefined && !FORMATS.includes(values.format)) {
  process.stderr.write(`--format takes one of ${FORMATS.join(', ')}.\n\n${usage}\n`)
  process.exit(2)
}

let actions
if (values.action !== undefined || values['action-event'] !== undefined) {
  const buttons = (values.action ?? []).map((spec) => {
    const at = spec.indexOf('=')
    return at < 1 ? undefined : { id: spec.slice(0, at), label: spec.slice(at + 1) }
  })
  if (buttons.length === 0 || buttons.includes(undefined) || values['action-event'] === undefined) {
    process.stderr.write(`Buttons need --action <id>=<label> (one or more) and --action-event.\n\n${usage}\n`)
    process.exit(2)
  }
  let data = {}
  try {
    if (values['action-data'] !== undefined) data = JSON.parse(values['action-data'])
  } catch {
    process.stderr.write(`--action-data is not valid JSON.\n\n${usage}\n`)
    process.exit(2)
  }
  actions = {
    buttons,
    event: values['action-event'],
    data,
    users: values['action-user'] ?? [],
    ...(values['action-expires'] === undefined ? {} : { expires: values['action-expires'] }),
  }
}

let text = positionals.join(' ')
if (positionals.length === 0 && !process.stdin.isTTY) text = readFileSync(0, 'utf8')
const files = (values.file ?? []).map((path) => resolve(path))
if (text.trim().length === 0 && files.length === 0) {
  process.stderr.write(`Nothing to send: give text or --file.\n\n${usage}\n`)
  process.exit(2)
}

/** DSH session ids carry a `session-` prefix; DSH_SESSION_ID may not. */
function sessionIdOf(value) {
  const id = (value ?? '').trim()
  if (id.length === 0) return undefined
  return id.startsWith('session-') ? id : `session-${id}`
}

const from = {}
if (values.from !== undefined && values.from.trim().length > 0) from.label = values.from.trim()
if (values.job !== undefined && values.job.trim().length > 0) from.job = values.job.trim()
const sessionId = sessionIdOf(values['from-session'] ?? process.env.DSH_SESSION_ID)
if (sessionId !== undefined) from.sessionId = sessionId

const id = await enqueue({
  to: values.thread.trim(),
  ...(values.chat === undefined ? {} : { chat: values.chat.trim() }),
  text,
  files,
  ...(Object.keys(from).length === 0 ? {} : { from }),
  ...(values.format === undefined ? {} : { format: values.format }),
  ...(values.silent ? { silent: true } : {}),
  ...(values.voice ? { asVoice: true } : {}),
  ...(actions === undefined ? {} : { actions }),
})
if (values['no-wait']) {
  process.stdout.write(`${JSON.stringify({ queued: id })}\n`)
  process.exit(0)
}
const seconds = Number(values.timeout ?? 30)
const result = await waitForResult(id, (Number.isFinite(seconds) && seconds > 0 ? seconds : 30) * 1000)
if (result === undefined) {
  process.stderr.write(`Still queued as ${id}: the Telegram bot did not pick it up in time. It is sent once the bot runs.\n`)
  process.exit(3)
}
if (!result.ok) {
  process.stderr.write(`${result.error}\n`)
  process.exit(1)
}
process.stdout.write(`${JSON.stringify(result.result)}\n`)
