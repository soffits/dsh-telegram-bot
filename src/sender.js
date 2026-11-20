/**
 * Telegram's principals: the user who wrote a message in a topic, and the
 * sender of a post into a topic. The shared principal fields, the send
 * principal and the tagger that records them on prompts are
 * @soffits/dsh-channel-core's.
 */
import { nonEmpty, sendPrincipal } from '@soffits/dsh-channel-core'

/**
 * The Telegram user who wrote a message, and where.
 * @param user - Telegram `from` of the message.
 * @param where - `{ chatId, threadId, topic }`: the chat, its topic thread and the topic's name.
 * @returns the principal, or undefined without a sender.
 */
export function telegramUserPrincipal(user, { chatId, threadId, topic } = {}) {
  if (user === undefined || user === null || user.id === undefined || user.id === null) return undefined
  const name = [user.first_name, user.last_name].map(nonEmpty).filter((part) => part !== undefined).join(' ')
  const username = nonEmpty(user.username)
  const chat = chatId === undefined || chatId === null
    ? undefined
    : {
        id: String(chatId),
        ...(Number.isSafeInteger(threadId) && threadId > 0 ? { thread: threadId } : {}),
        ...(nonEmpty(topic) === undefined ? {} : { name: nonEmpty(topic) }),
      }
  return {
    kind: 'telegram-user',
    channel: 'telegram',
    id: String(user.id),
    ...(name.length > 0 ? { name } : {}),
    ...(username === undefined ? {} : { username }),
    ...(chat === undefined ? {} : { chat }),
  }
}

/**
 * The sender of a message the bot posted into a topic, with where it went:
 * the principal of the post's copy in the bound session. A send that names
 * no sender is still marked as not typed by a person.
 * @param from - the request's `{ job, jobId, sessionId, label }`.
 * @param chat - `{ id, thread, name }` of the topic it was posted to.
 * @returns the principal.
 */
export function postPrincipal(from, chat) {
  const sender = sendPrincipal(from) ?? { kind: 'external', channel: 'external', id: 'unnamed', name: 'an unnamed sender' }
  return { ...sender, chat: { channel: 'telegram', ...chat } }
}
