/** Topic names known to the bot, send targets and topic errors. */

/**
 * Pick the topic name a Telegram message announces, if any.
 * @param message - Telegram message, including service messages.
 * @returns `{ name, authoritative }`, or undefined.
 */
export function topicNameOf(message) {
  const created = message?.forum_topic_created?.name
  if (typeof created === 'string' && created.trim().length > 0) return { name: created.trim(), authoritative: true }
  const edited = message?.forum_topic_edited?.name
  if (typeof edited === 'string' && edited.trim().length > 0) return { name: edited.trim(), authoritative: true }
  // Replies in a topic often carry its creation message; use it only to fill
  // a gap, because it shows the name the topic was created with.
  const original = message?.reply_to_message?.forum_topic_created?.name
  if (typeof original === 'string' && original.trim().length > 0) return { name: original.trim(), authoritative: false }
  return undefined
}

/** Where a bot session comes from, the first part of its DSH title. */
export const TITLE_SOURCE = 'Telegram'

/** Joins the source, the person and the task in a session title. */
const TITLE_JOIN = '-'

/** Joined a topic name and the task in titles of earlier versions. */
const LEGACY_SEPARATOR = ' · '

/** The title form the oldest versions gave topic sessions: "TG · <topic name>". */
const LEGACY_PREFIX = 'TG · '

/**
 * The DSH title of a bot session: "Telegram-<person>-<task>". Before DSH has
 * titled the conversation, a topic's name stands in for the task.
 * @param person - whose chat it is: a person's name, or a group's title.
 * @param task - what the conversation is about; empty gives "Telegram-<person>".
 * @returns the session title.
 */
export function sessionTitleOf(person, task) {
  const rest = typeof task === 'string' ? task.trim() : ''
  const head = `${TITLE_SOURCE}${TITLE_JOIN}${person}`
  return rest.length === 0 ? head : `${head}${TITLE_JOIN}${rest}`
}

/**
 * Whether a title is a placeholder the bot set before any conversation title
 * existed, in this version's form or an earlier one: "Telegram-<person>-<topic
 * name>", a bare topic name, or "TG · <topic name>".
 * @param title - current session title.
 * @param names - topic names the title may carry (current and earlier).
 * @param people - person labels the title may carry (current and earlier).
 * @returns true for a bot placeholder.
 */
export function isPlaceholderTitle(title, names, people = []) {
  if (typeof title !== 'string') return false
  if (title.startsWith(LEGACY_PREFIX) || names.includes(title)) return true
  return people.some((person) => names.some((name) => sessionTitleOf(person, name) === title))
}

/**
 * Head of the sender line versions before 0.6.1 put at the top of every
 * Telegram prompt. DSH's first-prompt title fallback took its first words, so
 * sessions from then carry titles like "Telegram-Ana-[Telegram message from
 * Ana (@ana," or "Chat-1 · [Telegram message from Ana (@ana,".
 */
export const SENDER_LINE_HEAD = '[Telegram message from '

/**
 * Heads of the context blocks versions before 0.6.2 put at the top of a
 * prompt, before the person's words: a reply, a message the bot posted for
 * someone else, a forward. They lead to titles the same way.
 */
const CONTEXT_HEADS = ['[Replying to ', '[The replied-to message ', '[Forwarded message from ']

/**
 * Whether a title was built from text the bot added to a prompt (the sender
 * line or a context block) instead of the person's words.
 * @param title - current session title.
 * @returns true when the title carries such a head.
 */
export function hasBotPreamble(title) {
  return typeof title === 'string' && [SENDER_LINE_HEAD, ...CONTEXT_HEADS].some((head) => title.includes(head))
}

/**
 * Split an old prompt into its sender line and the person's own text.
 * @param text - prompt text as logged.
 * @returns `{ text, userId }`: the text without a leading sender line, and
 *   the Telegram user id that line named (undefined without one).
 */
export function withoutSenderLine(text) {
  if (typeof text !== 'string' || !text.startsWith(SENDER_LINE_HEAD)) return { text: typeof text === 'string' ? text : '', userId: undefined }
  const end = text.indexOf('\n')
  const line = end === -1 ? text : text.slice(0, end)
  const id = /user id (-?\d+)\)?\]$/u.exec(line)?.[1]
  return { text: end === -1 ? '' : text.slice(end + 1), userId: id === undefined ? undefined : Number(id) }
}

/**
 * The words a person sent in a prompt logged by an earlier version, without
 * the context blocks the bot put before them. Blocks are separated by blank
 * lines and quote their text line by line, so a quoted blank line is never
 * empty. A forward's text was quoted inside its block; with nothing after the
 * blocks, that text is what was sent.
 * @param text - prompt text without its sender line.
 * @returns the person's words, possibly empty.
 */
export function withoutContextBlocks(text) {
  const blocks = String(text ?? '').split('\n\n')
  let forwarded = ''
  while (blocks.length > 0 && CONTEXT_HEADS.some((head) => blocks[0].startsWith(head))) {
    const block = blocks.shift()
    if (block.startsWith('[Forwarded message from ')) {
      forwarded = block.split('\n').slice(1).filter((line) => line.startsWith('>')).map((line) => line.replace(/^> ?/u, '')).join('\n')
    }
  }
  const rest = blocks.join('\n\n').trim()
  return rest.length > 0 ? rest : forwarded.trim()
}

/**
 * The leading words of a prompt within a word and UTF-8 byte budget, cut the
 * way DSH cuts its first-prompt title, without splitting a character.
 * @param text - prompt text.
 * @param maxWords - most whitespace-separated words.
 * @param maxBytes - most UTF-8 bytes.
 * @returns one trimmed line, possibly empty.
 */
export function leadingWords(text, maxWords, maxBytes) {
  const words = String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').split(/\s+/u).filter(Boolean).slice(0, maxWords).join(' ')
  let output = ''
  let used = 0
  for (const character of words) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output.trimEnd()
}

/**
 * The conversation part of a title, without the source, person or topic-name
 * prefix the bot added in this or an earlier version.
 * @param title - current session title.
 * @param names - topic names an earlier-form prefix may carry.
 * @param people - person labels a prefix may carry.
 * @returns the task part; empty when the title is only a placeholder.
 */
export function titleTask(title, names, people = []) {
  if (isPlaceholderTitle(title, names, people)) return ''
  // Longest label first, so "Ann-Marie" wins over "Ann".
  for (const person of [...people].sort((a, b) => b.length - a.length)) {
    const head = sessionTitleOf(person, '')
    if (title === head) return ''
    if (title.startsWith(`${head}${TITLE_JOIN}`)) return title.slice(head.length + TITLE_JOIN.length).trim()
  }
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (title.startsWith(`${name}${LEGACY_SEPARATOR}`)) return title.slice(name.length + LEGACY_SEPARATOR.length).trim()
  }
  return title
}

/**
 * Decide how a bot session's title should change. DSH has no title hook, so
 * the bot rewrites titles after the fact: a missing title or a bot
 * placeholder becomes the current placeholder through a user rename (which
 * stops DSH's own fallback from replacing it); a generated title gets the
 * prefix by re-appending it with the same source, so automatic titling keeps
 * running. A title someone typed is left alone.
 * @param current - the latest title snapshot (`{ title, source }`), if any.
 * @param options - `person`, the label for the chat now; `names`, topic names
 *   the title may carry, current first (empty for a chat without topics);
 *   `people`, earlier person labels the title may carry.
 * @returns `{ kind: 'rename' | 'append', title }`, or `{ kind: 'none' }`.
 */
export function plannedTitle(current, { person, names = [], people = [] }) {
  const labels = [person, ...people.filter((label) => label !== person)]
  const placeholder = names.length > 0 ? sessionTitleOf(person, names[0]) : undefined
  if (current === undefined || typeof current?.title !== 'string') {
    return placeholder === undefined ? { kind: 'none' } : { kind: 'rename', title: placeholder }
  }
  const title = current.title
  if (current.source?.kind === 'user') {
    const stale = placeholder !== undefined && title !== placeholder && isPlaceholderTitle(title, names, labels)
    return stale ? { kind: 'rename', title: placeholder } : { kind: 'none' }
  }
  const task = titleTask(title, names, labels)
  const wanted = task.length > 0 ? sessionTitleOf(person, task) : (placeholder ?? sessionTitleOf(person, ''))
  return wanted === title ? { kind: 'none' } : { kind: 'append', title: wanted }
}

/**
 * Commands about the chat as a whole rather than one topic. When one of them
 * is sent in All, Telegram turns it into a topic of its own; the bot answers
 * in All instead and removes that topic.
 */
export const CHAT_COMMANDS = new Set(['/start', '/help', '/sessions', '/status', '/menu', '/id', '/ping', '/restart'])

/**
 * Whether a message is a chat-wide command that Telegram moved into a topic it
 * created for that very message: users who may create topics get one for any
 * message sent in All, named after the message.
 * @param command - normalized command token, such as `/start`.
 * @param text - full message text.
 * @param topicName - known name of the message's topic, if any.
 * @param fresh - whether the topic has no session and no earlier activity.
 * @returns true when the command should be answered in All.
 */
export function isAutoCommandTopic(command, text, topicName, fresh) {
  if (!fresh || !CHAT_COMMANDS.has(command)) return false
  if (typeof topicName !== 'string' || typeof text !== 'string') return false
  const name = topicName.trim()
  // Telegram names the topic after the message, cut to 128 characters.
  return name.startsWith('/') && text.trim().startsWith(name)
}

/**
 * Whether a Bot API error means the topic itself no longer exists, so its
 * binding can never work again. A closed topic is not gone: it can be reopened.
 * @param description - Telegram's error description.
 * @returns true for a deleted or invalid topic.
 */
export function isTopicGone(description) {
  return /message thread not found|(?:topic|thread)[^.]{0,40}(?:not found|deleted)|TOPIC_ID_INVALID|TOPIC_DELETED/iu.test(String(description ?? ''))
}

/** True when a thread id denotes the chat-wide All topic. */
function isAllTopic(threadId) {
  return threadId === undefined || threadId === null || threadId === 0 || threadId === 1
}

/**
 * Outbound topic fields for send methods. Private-chat and forum topics use
 * `message_thread_id`; a cached direct id is used only for chats without a
 * forum thread (for example channel direct-messages chats).
 * @param directChats - `{ "<chatId>": true }` for private chats with topics.
 * @param directTopics - `{ "<chatId>:<threadId>": directTopicId }`.
 * @param chatId - chat holding the topic.
 * @param threadId - stored topic thread id.
 * @returns `{}`, `{ message_thread_id }` or `{ direct_messages_topic_id }`.
 */
export function topicTargetFor(directChats, directTopics, chatId, threadId) {
  if (isAllTopic(threadId)) return {}
  // Private-chat topics use message_thread_id. If Telegram rejects it with
  // "message thread not found", call() retries with direct_messages_topic_id.
  if (directChats?.[String(chatId)] === true) return { message_thread_id: threadId }
  const direct = directTopics?.[`${chatId}:${threadId}`]
  if (Number.isSafeInteger(direct)) return { direct_messages_topic_id: direct }
  return { message_thread_id: threadId }
}

/**
 * Whether a Bot API message proves it reached the expected topic. A response
 * without any topic field is not proof: Telegram may have silently sent the
 * message into All after the topic was deleted.
 * @param directChats - `{ "<chatId>": true }` for private chats with topics.
 * @param directTopics - `{ "<chatId>:<threadId>": directTopicId }`.
 * @param chatId - chat holding the topic.
 * @param threadId - stored topic thread id.
 * @param delivered - Bot API result for the sent message.
 * @returns whether the message belongs to the expected topic.
 */
export function deliveredToTopic(directChats, directTopics, chatId, threadId, delivered) {
  if (delivered === null || typeof delivered !== 'object') return false
  if (typeof delivered.message_thread_id === 'number') return delivered.message_thread_id === threadId
  const direct = delivered.direct_messages_topic?.topic_id
  if (typeof direct === 'number') {
    if (directChats?.[String(chatId)] === true) return direct === threadId
    const expected = directTopics?.[`${chatId}:${threadId}`]
    return typeof expected !== 'number' || direct === expected
  }
  // No topic fields at all: Telegram silently drops a message into All when
  // the topic is gone, so this is not proof of delivery.
  return false
}

/**
 * Resolve a programmatic send target to the chat that owns the thread.
 * Thread ids belong to one chat (each private chat has its own topics), so
 * the chat comes from where the bot saw the thread, never from whichever chat
 * spoke last. Only numeric thread ids are accepted; topic names are display
 * text, not addresses.
 * @param keys - known `"<chatId>:<threadId>"` topic keys.
 * @param chat - chat id the caller names, or undefined to use the owner.
 * @param target - thread id, as a number or a string of digits.
 * @returns `{ chatId, threadId }`.
 */
export function resolveSendTarget(keys, chat, target) {
  const raw = typeof target === 'number' ? String(target) : String(target ?? '').trim()
  if (raw.length === 0) throw new Error('A Telegram thread id is required.')
  if (!/^\d+$/u.test(raw)) throw new Error(`"${raw}" is not a Telegram thread id. Topics are addressed by their numeric thread id; /id in a topic shows it.`)
  const threadId = Number(raw)
  const owners = [...new Set([...keys]
    .map((key) => String(key).match(/^(-?\d+):(\d+)$/u))
    .filter((match) => match !== null && Number(match[2]) === threadId)
    .map((match) => match[1]))]
  const wanted = typeof chat === 'number' ? String(chat) : String(chat ?? '').trim()
  if (wanted.length > 0) {
    if (!/^-?\d+$/u.test(wanted)) throw new Error(`"${wanted}" is not a Telegram chat id.`)
    if (!owners.includes(wanted)) throw new Error(`Unknown thread id ${threadId} in chat ${wanted}: the bot knows no topic with that id there. /id in a topic shows its thread id.`)
    return { chatId: Number(wanted), threadId }
  }
  if (owners.length === 0) throw new Error(`Unknown thread id ${threadId}: the bot knows no topic with that id in any chat. /id in a topic shows its thread id.`)
  if (owners.length > 1) throw new Error(`Thread id ${threadId} exists in several chats (${owners.join(', ')}); name the chat to send to.`)
  return { chatId: Number(owners[0]), threadId }
}

/**
 * Resolve a `/topic delete` target typed by a person: a topic thread id, or a
 * known topic name compared without regard to case. Programmatic sends use
 * `resolveSendTarget`, since names can change.
 * @param names - `{ "<chatId>:<threadId>": name }`.
 * @param chatId - chat the topics live in.
 * @param target - topic name or thread id.
 * @returns `{ threadId, name }`.
 */
export function resolveTopicTarget(names, chatId, target) {
  const raw = typeof target === 'number' ? String(target) : String(target ?? '').trim()
  if (raw.length === 0) throw new Error('A topic name or thread id is required.')
  const known = Object.entries(names ?? {})
    .filter(([key]) => key.startsWith(`${chatId}:`))
    .map(([key, name]) => ({ threadId: Number(key.slice(String(chatId).length + 1)), name: String(name) }))
  if (/^\d+$/u.test(raw)) {
    const threadId = Number(raw)
    if (!Number.isSafeInteger(threadId) || threadId <= 0 || threadId > 2_147_483_647) {
      const list = known.map((entry) => `"${entry.name}" (${entry.threadId})`).join(', ')
      throw new Error(`"${raw}" is not a Telegram topic id. Topic ids are message-thread ids (for example 55221).${list.length > 0 ? ` Known topics: ${list}.` : ''} Send /id inside the topic to see its id.`)
    }
    return { threadId, name: known.find((entry) => entry.threadId === threadId)?.name }
  }
  const wanted = raw.toLocaleLowerCase()
  const matches = known.filter((entry) => entry.name.trim().toLocaleLowerCase() === wanted)
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw new Error(`Several topics are named "${raw}" (thread ids ${matches.map((entry) => entry.threadId).join(', ')}). Send to a thread id instead.`)
  }
  const list = known.map((entry) => `"${entry.name}" (${entry.threadId})`).join(', ')
  throw new Error(`Unknown Telegram topic "${raw}". ${list.length > 0 ? `Known topics: ${list}.` : 'The bot knows no topic names yet.'} Rename the topic in Telegram or with /rename so the bot learns its name, or send to its thread id (/id in the topic).`)
}

/** Extensions per Telegram upload kind, for files sent into a topic. */
const UPLOAD_KINDS = [
  { method: 'sendPhoto', field: 'photo', extensions: ['.jpg', '.jpeg', '.png', '.webp'], maxBytes: 10 * 1024 * 1024 },
  { method: 'sendAnimation', field: 'animation', extensions: ['.gif'] },
  { method: 'sendVoice', field: 'voice', extensions: ['.ogg', '.oga', '.opus'], voiceOnly: true },
  { method: 'sendAudio', field: 'audio', extensions: ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus'] },
  { method: 'sendVideo', field: 'video', extensions: ['.mp4', '.mov', '.webm', '.mkv'] },
]

/**
 * The Bot API method that shows a file best: pictures inline, GIFs as
 * animations, audio in the player (Opus/Ogg as a voice message when asked),
 * video in the player, anything else as a document.
 * @param name - file name.
 * @param size - file size in bytes.
 * @param asVoice - send Opus/Ogg audio as a voice message.
 * @returns `{ method, field }`.
 */
export function uploadMethod(name, size, asVoice = false) {
  const dot = name.lastIndexOf('.')
  const extension = dot < 0 ? '' : name.slice(dot).toLowerCase()
  const kind = UPLOAD_KINDS.find((entry) => entry.extensions.includes(extension)
    && (entry.voiceOnly !== true || asVoice)
    && (entry.maxBytes === undefined || size <= entry.maxBytes))
  return kind === undefined ? { method: 'sendDocument', field: 'document' } : { method: kind.method, field: kind.field }
}
