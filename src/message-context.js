/**
 * What an incoming Telegram message replies to, quotes or forwards, as
 * metadata for the message's `source.envelope`. The model reads it through a
 * renderer such as dsh-message-context; the message text stays as sent.
 */
import { formatTelegramDate } from './clock.js'

/** Largest file Telegram lets a bot download (getFile). */
export const DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024

/** Labels the bridge puts on prompts it mirrors from other clients. */
const MIRROR_LABELS = [
  ['🖥 From Web:', 'the Web UI (a user prompt this bot mirrored into the chat, not an assistant answer)'],
  ['🖥 Из Web:', 'the Web UI (a user prompt this bot mirrored into the chat, not an assistant answer)'],
  ['🤖 From agent session ', 'another agent session (a prompt one agent sent another, mirrored into the chat; not the user and not an assistant answer)'],
  ['🤖 От агента, сессия ', 'another agent session (a prompt one agent sent another, mirrored into the chat; not the user and not an assistant answer)'],
  ['⏰ Scheduled task:', 'a scheduled task (a prompt this bot mirrored into the chat, not an assistant answer)'],
  ['⏰ Задача по расписанию:', 'a scheduled task (a prompt this bot mirrored into the chat, not an assistant answer)'],
]

/**
 * Text or caption of a message.
 * @param message - Telegram message or external reply.
 * @returns the text, or an empty string.
 */
export function messageBody(message) {
  if (typeof message?.text === 'string') return message.text
  if (typeof message?.caption === 'string') return message.caption
  return ''
}

/**
 * True when the message was forwarded from somewhere else.
 * @param message - Telegram message.
 */
export function isForwarded(message) {
  return originOf(message) !== undefined
}

/**
 * The photo, document, spoken recording (voice, audio, round video) or
 * sticker of a message, when the bot can download it.
 * @param message - Telegram message or external reply.
 * @returns the file kind and size, or undefined.
 */
export function downloadableFile(message) {
  const photo = Array.isArray(message?.photo) ? message.photo.at(-1) : undefined
  const candidates = [['photo', photo], ['document', message?.document], ['voice', message?.voice], ['video_note', message?.video_note], ['audio', message?.audio], ['sticker', message?.sticker]]
  const found = candidates.find(([, file]) => typeof file?.file_id === 'string')
  if (found === undefined) return undefined
  const [kind, file] = found
  return { kind, size: typeof file.file_size === 'number' ? file.file_size : undefined }
}

/**
 * The message a reply points at, ignoring the topic's own first message,
 * which Telegram sets as the reply target of every message in a topic.
 * @param message - Telegram message.
 * @returns the replied-to message, or undefined.
 */
export function repliedMessage(message) {
  const target = message?.reply_to_message
  if (target === undefined || target === null) return undefined
  if (target.forum_topic_created !== undefined) return undefined
  if (message.is_topic_message === true && target.message_id === message.message_thread_id) return undefined
  return target
}

/**
 * Chat and message id of the message a reply points at, for looking it up
 * in the sent-message log.
 * @param message - Telegram message.
 * @returns { chatId, messageId }, or undefined when it is not a reply.
 */
export function replyReference(message) {
  if (originOf(message) !== undefined) return undefined
  const target = repliedMessage(message)
  if (target !== undefined) return { chatId: target.chat?.id ?? message.chat?.id, messageId: target.message_id }
  const external = message?.external_reply
  if (external?.chat?.id !== undefined && Number.isSafeInteger(external.message_id)) return { chatId: external.chat.id, messageId: external.message_id }
  return undefined
}

/**
 * Build the prompt for one message: the person's own words, and what the
 * message replies to or was forwarded from as metadata for the message's
 * `source.envelope` (see dsh-message-context for the contract). Nothing is
 * added to the text, so the prompt, and the session title DSH takes from its
 * first words, holds only what was sent. A forwarded message's text is its
 * content and stays in the prompt; its origin is metadata.
 * @param message - Telegram message.
 * @param options - botId: this bot's user id; replyFile: outcome of attaching
 *   the replied-to file ('attached', 'too-large', 'failed'); ownFile: true when
 *   the message's own photo or document is attached; sent: the sent-message
 *   log entry the replied-to message belongs to; currentSession: the session
 *   now bound to the topic; formatDate: turns a Telegram time (Unix seconds)
 *   into text, UTC when absent.
 * @returns `{ text, replyTo, forwardedFrom }`: the message text, possibly
 *   empty, and the envelope fields (undefined when the message has none).
 */
export function composePrompt(message, options = {}) {
  const text = messageBody(message).trim()
  const forwardedFrom = forwardInfo(message, options)
  const reply = forwardedFrom === undefined ? replyInfo(message, options) : undefined
  const replyTo = reply === undefined ? undefined : withSent(reply, options.sent, options)
  return { text, replyTo, forwardedFrom }
}

/**
 * What the message replies to, as `envelope.replyTo`.
 * @returns `{ from, sentAt, text, quoted, details }` (fields only when known), or undefined.
 */
export function replyInfo(message, options = {}) {
  const quote = typeof message?.quote?.text === 'string' && message.quote.text.trim().length > 0 ? message.quote.text : undefined
  const target = repliedMessage(message)
  if (target !== undefined) {
    const { from, details } = senderOf(target, message, options)
    const origin = originOf(target)
    if (origin !== undefined) details.push(`forwarded from ${describeOrigin(origin, message, options)}${origin.date === undefined ? '' : `, originally sent ${formatDate(origin.date, options)}`}`)
    const media = mediaNote(target, options.replyFile)
    if (media !== undefined) details.push(media)
    return compact({ from, sentAt: epochMs(target.date), text: nonBlank(quote ?? messageBody(target)), quoted: quote === undefined ? undefined : true, details })
  }
  const external = message?.external_reply
  if (external === undefined || external === null) {
    return message?.reply_to_story === undefined ? undefined : { details: ['a Telegram story'] }
  }
  const details = []
  if (external.chat !== undefined && external.origin?.type !== 'channel') details.push(`in another chat, ${chatName(external.chat)}`)
  else details.push('in another chat')
  const link = messageLink(external.chat, external.message_id)
  if (link !== undefined) details.push(link)
  const media = mediaNote(external, options.replyFile)
  if (media !== undefined) details.push(media)
  if (quote === undefined) details.push('the bot cannot see the text of messages in other chats unless the sender quotes it')
  const origin = external.origin === undefined ? undefined : originParty(external.origin, message, options)
  return compact({ from: origin?.from, sentAt: epochMs(external.origin?.date), text: quote, quoted: quote === undefined ? undefined : true, details: [...(origin?.details ?? []), ...details] })
}

/**
 * Where a forwarded message comes from, as `envelope.forwardedFrom`.
 * @returns `{ from, sentAt, details }`, or undefined when the message is not forwarded.
 */
export function forwardInfo(message, options = {}) {
  const origin = originOf(message)
  if (origin === undefined) return undefined
  const { from, details } = originParty(origin, message, options)
  const link = origin.type === 'channel' ? messageLink(origin.chat, origin.message_id) : undefined
  if (link !== undefined) details.push(link)
  const media = mediaNote(message, options.ownFile === true ? 'attached' : undefined)
  if (media !== undefined) details.push(media)
  return compact({ from, sentAt: epochMs(origin.date), details })
}

/**
 * Say where a forwarded message comes from, as a line of text. Used only
 * where several forwards are sent as one prompt: the first one's origin is
 * metadata, each later one keeps its origin next to its own text.
 * @returns the line, or undefined when the message is not forwarded.
 */
export function describeForward(message, options = {}) {
  const origin = originOf(message)
  if (origin === undefined) return undefined
  const details = []
  if (origin.date !== undefined) details.push(`originally sent ${formatDate(origin.date, options)}`)
  const link = origin.type === 'channel' ? messageLink(origin.chat, origin.message_id) : undefined
  if (link !== undefined) details.push(link)
  const media = mediaNote(message, options.ownFile === true ? 'attached' : undefined)
  if (media !== undefined) details.push(media)
  return `[Forwarded message from ${describeOrigin(origin, message, options)}${details.length === 0 ? '' : ` (${details.join('; ')})`}]`
}

/**
 * A reply to a message the bot sent into a topic on someone's behalf (a
 * script, a job, a plugin or another session): the sender, time and full text
 * come from the sent-message log, since the message may span several
 * Telegram messages and its real author is not the bot.
 * @param reply - the reply from `replyInfo`.
 * @param sent - entry from the sent-message log, if the replied-to message is in it.
 * @param options - currentSession: session now bound to the topic.
 * @returns the reply, with the log entry's facts when there is one.
 */
export function withSent(reply, sent, options = {}) {
  if (sent === undefined || sent === null) return reply
  const details = ['posted by the bot on behalf of another sender']
  if (Array.isArray(sent.messageIds) && sent.messageIds.length > 1) details.push(`${sent.messageIds.length} Telegram messages`)
  if (sent.sticker !== undefined && sent.sticker !== null) details.push(`with sticker ${[sent.sticker.emoji, sent.sticker.setName === null || sent.sticker.setName === undefined ? undefined : `from set "${sent.sticker.setName}"`, `(${sent.sticker.id})`].filter(Boolean).join(' ')}`)
  if (Array.isArray(sent.files) && sent.files.length > 0) details.push(`with ${sent.files.length === 1 ? 'file' : 'files'} ${sent.files.map((name) => `"${name}"`).join(', ')}`)
  const bound = typeof sent.boundSession === 'string' ? sent.boundSession : undefined
  if (bound !== undefined && sent.recorded === true && bound !== options.currentSession) details.push(`recorded in session ${bound}, not this one`)
  else if (bound === undefined) details.push('the topic had no session then')
  const sessions = [sent.fromSession, bound !== options.currentSession && sent.recorded === true ? bound : undefined]
    .filter((id, index, all) => typeof id === 'string' && id.length > 0 && all.indexOf(id) === index)
  if (sessions.length > 0) details.push(`for more context, open session ${sessions.join(' or ')}`)
  const time = Date.parse(sent.sentAt ?? '')
  const text = typeof sent.text === 'string' && sent.text.trim().length > 0
    ? sent.text + (sent.textCut > 0 ? `\n[…${sent.textCut} more characters not kept]` : '')
    : undefined
  return compact({
    from: sentParty(sent) ?? reply.from,
    sentAt: Number.isFinite(time) ? time : reply.sentAt,
    text: text ?? reply.text,
    quoted: text === undefined ? reply.quoted : undefined,
    details: [...details, ...(reply.details ?? [])],
  })
}

/** The sender of a logged send, in the principal shape of the bot's sends. */
function sentParty(sent) {
  const job = nonBlank(sent.job)
  const fromSession = nonBlank(sent.fromSession)
  const label = nonBlank(sent.label)
  if (job !== undefined) return { kind: 'cron-job', channel: 'cron', id: nonBlank(sent.jobId) ?? job, name: job }
  if (fromSession !== undefined) return { kind: 'dsh-session', channel: 'dsh', id: fromSession }
  if (label !== undefined) return { kind: 'external', channel: 'external', id: label, name: label }
  return undefined
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function epochMs(seconds) {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : undefined
}

/** A copy without undefined fields and without an empty `details`. */
function compact(record) {
  const out = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue
    if (key === 'details' && Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out
}

/** A Telegram user as a reply's or forward's author. */
function telegramParty(user) {
  const name = [user.first_name, user.last_name].filter((part) => typeof part === 'string' && part.length > 0).join(' ')
  return compact({
    kind: 'telegram-user',
    channel: 'telegram',
    id: user.id === undefined || user.id === null ? undefined : String(user.id),
    name: name.length > 0 ? name : undefined,
    username: nonBlank(user.username),
  })
}

/** Who wrote a replied-to message, from the reader's point of view. */
function senderOf(target, message, options) {
  const from = target.from
  if (from !== undefined && options.botId !== undefined && from.id === options.botId) {
    const text = messageBody(target)
    const mirrored = MIRROR_LABELS.find(([label]) => text.startsWith(label))
    return mirrored === undefined ? { from: { role: 'assistant' }, details: [] } : { from: { name: mirrored[1] }, details: [] }
  }
  if (target.sender_chat !== undefined) return { from: { name: chatName(target.sender_chat) }, details: [] }
  if (from !== undefined && message?.from !== undefined && from.id === message.from.id) return { from: { role: 'sender' }, details: [] }
  if (from !== undefined) return { from: telegramParty(from), details: from.is_bot === true ? ['written by a bot'] : [] }
  return { from: undefined, details: [] }
}

/** The author of a forward origin, from the reader's point of view. */
function originParty(origin, message, options) {
  const signature = typeof origin.author_signature === 'string' && origin.author_signature.length > 0 ? `, signed ${origin.author_signature}` : ''
  if (origin.type === 'user') {
    const user = origin.sender_user
    if (user !== undefined && options.botId !== undefined && user.id === options.botId) return { from: { role: 'assistant' }, details: [] }
    if (user !== undefined && message?.from !== undefined && user.id === message.from.id) return { from: { role: 'sender' }, details: [] }
    if (user === undefined) return { from: { name: 'a user' }, details: [] }
    return { from: telegramParty(user), details: user.is_bot === true ? ['written by a bot'] : [] }
  }
  if (origin.type === 'hidden_user') return { from: { name: `${origin.sender_user_name ?? 'a user'} (account hidden)` }, details: [] }
  if (origin.type === 'channel') return { from: { name: `channel ${chatName(origin.chat)}${signature}` }, details: [] }
  if (origin.type === 'chat') return { from: { name: `${chatName(origin.sender_chat)}${signature}` }, details: [] }
  return { from: { name: 'an unknown source' }, details: [] }
}

/** Forward origin of a message, including the fields older Bot API versions used. */
function originOf(message) {
  if (message?.forward_origin !== undefined && message.forward_origin !== null) return message.forward_origin
  const date = message?.forward_date
  if (message?.forward_from_chat !== undefined) {
    return { type: message.forward_from_chat.type === 'channel' ? 'channel' : 'chat', chat: message.forward_from_chat, sender_chat: message.forward_from_chat, message_id: message.forward_from_message_id, author_signature: message.forward_signature, date }
  }
  if (message?.forward_from !== undefined) return { type: 'user', sender_user: message.forward_from, date }
  if (typeof message?.forward_sender_name === 'string') return { type: 'hidden_user', sender_user_name: message.forward_sender_name, date }
  return undefined
}

/** Name the origin of a forwarded message. */
function describeOrigin(origin, message, options) {
  const signature = typeof origin.author_signature === 'string' && origin.author_signature.length > 0 ? `, signed ${origin.author_signature}` : ''
  if (origin.type === 'user') {
    const user = origin.sender_user
    if (user !== undefined && options.botId !== undefined && user.id === options.botId) return 'the assistant (this bot)'
    if (user !== undefined && message?.from !== undefined && user.id === message.from.id) return 'the user themselves'
    return user === undefined ? 'a user' : personName(user)
  }
  if (origin.type === 'hidden_user') return `${origin.sender_user_name ?? 'a user'} (account hidden)`
  if (origin.type === 'channel') return `channel ${chatName(origin.chat)}${signature}`
  if (origin.type === 'chat') return `${chatName(origin.sender_chat)}${signature}`
  return 'an unknown source'
}

function personName(user) {
  const name = [user.first_name, user.last_name].filter((part) => typeof part === 'string' && part.length > 0).join(' ')
  const handle = typeof user.username === 'string' && user.username.length > 0 ? `@${user.username}` : ''
  const label = name.length > 0 ? (handle.length > 0 ? `${name} (${handle})` : name) : (handle.length > 0 ? handle : 'a user')
  return user.is_bot === true ? `${label}, a bot` : label
}

function chatName(chat) {
  if (chat === undefined || chat === null) return 'a chat'
  const title = typeof chat.title === 'string' && chat.title.length > 0
    ? `"${chat.title}"`
    : [chat.first_name, chat.last_name].filter(Boolean).join(' ')
  const handle = typeof chat.username === 'string' && chat.username.length > 0 ? `@${chat.username}` : ''
  if (title.length > 0) return handle.length > 0 ? `${title} (${handle})` : title
  return handle.length > 0 ? handle : 'a chat'
}

/** Public link to a channel or supergroup message, when one exists. */
function messageLink(chat, messageId) {
  if (chat === undefined || chat === null || !Number.isSafeInteger(messageId)) return undefined
  if (typeof chat.username === 'string' && chat.username.length > 0) return `https://t.me/${chat.username}/${messageId}`
  const id = String(chat.id ?? '')
  if (id.startsWith('-100')) return `https://t.me/c/${id.slice(4)}/${messageId}`
  return undefined
}

/** Note the media a message carries and whether it was attached. */
function mediaNote(message, fileOutcome) {
  const kind = mediaKind(message)
  if (kind === undefined) return undefined
  if (downloadableFile(message) === undefined) return `contains ${kind}, not attached`
  if (fileOutcome === 'attached') return `contains ${kind}, attached`
  if (fileOutcome === 'too-large') return `contains ${kind}, too large to attach`
  if (fileOutcome === 'failed') return `contains ${kind}, could not be downloaded`
  return `contains ${kind}`
}

function mediaKind(message) {
  if (message === undefined || message === null) return undefined
  if (Array.isArray(message.photo) && message.photo.length > 0) return 'a photo'
  if (message.document !== undefined && message.animation === undefined) {
    return typeof message.document.file_name === 'string' ? `a file "${message.document.file_name}"` : 'a file'
  }
  if (message.video !== undefined) return 'a video'
  if (message.animation !== undefined) return 'a GIF'
  if (message.audio !== undefined) {
    const title = [message.audio.performer, message.audio.title].filter(Boolean).join(' - ')
    return title.length > 0 ? `audio "${title}"` : 'audio'
  }
  if (message.voice !== undefined) return 'a voice message'
  if (message.video_note !== undefined) return 'a video message'
  if (message.sticker !== undefined) {
    const emoji = typeof message.sticker.emoji === 'string' ? ` ${message.sticker.emoji}` : ''
    const set = typeof message.sticker.set_name === 'string' ? ` from set "${message.sticker.set_name}"` : ''
    return `a sticker${emoji}${set}`
  }
  if (message.poll !== undefined) return `a poll "${message.poll.question ?? ''}"`
  if (message.venue !== undefined) return `a venue "${message.venue.title ?? ''}"`
  if (message.location !== undefined) return `a location (${message.location.latitude}, ${message.location.longitude})`
  if (message.contact !== undefined) return `a contact (${[message.contact.first_name, message.contact.last_name].filter(Boolean).join(' ')})`
  if (message.story !== undefined) return 'a story'
  if (message.paid_media !== undefined) return 'paid media'
  if (message.dice !== undefined) return `a dice roll ${message.dice.emoji ?? ''}`.trim()
  if (message.checklist !== undefined) return 'a checklist'
  if (message.game !== undefined) return 'a game'
  if (message.invoice !== undefined) return 'an invoice'
  return undefined
}

/**
 * A Telegram time (Unix seconds) as the model reads it.
 * @param seconds - Unix seconds.
 * @param options - `formatDate`: the bot's formatter for its configured zone;
 *   without one, UTC.
 */
function formatDate(seconds, options = {}) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'at an unknown time'
  return (typeof options.formatDate === 'function' ? options.formatDate(seconds) : undefined) ?? formatTelegramDate(seconds, 'UTC')
}
