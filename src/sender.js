/**
 * Who sent a message, as data on the message itself.
 *
 * DSH's field for the caller behind a user message is `source.principal`:
 * the session controller writes it for callers other than the owner, so an
 * absent principal means the owner. The bot admits every Telegram prompt as
 * the owner, so it fills the field itself, and also on the copies of sends it
 * records in bound sessions. Readers get the sender from it, not from text.
 *
 * Every principal has `kind`, `channel` and `id`, and `name` when one is
 * known; the other fields depend on the kind. None carries a credential, so
 * all are safe in a session log.
 *
 * The model learns the sender from a notice message placed right before the
 * prompt, not from a line inside the prompt: DSH titles a session from the
 * first words of its first human message, and those must be the person's own.
 */

import { randomUUID } from 'node:crypto'

/** Remembered prompts waiting for their step; the oldest go first past this. */
export const MAX_PENDING_PRINCIPALS = 1024

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

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
 * The sender of a send into a topic, from the request's `from`: a scheduled
 * job, else a DSH session, else the free-form label of an outside caller.
 * @param from - `{ job?, jobId?, sessionId?, label? }`.
 * @returns the principal, or undefined when the request names no sender.
 */
export function sendPrincipal(from) {
  const job = nonEmpty(from?.job)
  const jobId = nonEmpty(from?.jobId)
  const sessionId = nonEmpty(from?.sessionId)
  const label = nonEmpty(from?.label)
  if (job !== undefined || jobId !== undefined) {
    return {
      kind: 'cron-job',
      channel: 'cron',
      id: jobId ?? job,
      ...(job === undefined ? {} : { name: job }),
      ...(sessionId === undefined ? {} : { sessionId }),
    }
  }
  if (sessionId !== undefined) {
    return { kind: 'dsh-session', channel: 'dsh', id: sessionId, ...(label === undefined ? {} : { name: label }) }
  }
  if (label !== undefined) return { kind: 'external', channel: 'external', id: label, name: label }
  return undefined
}

/**
 * A frozen copy of a message whose source records its sender.
 * @param message - the user message.
 * @param principal - its sender.
 * @returns the copy; the message itself when there is no principal.
 */
export function withPrincipal(message, principal) {
  if (principal === undefined) return message
  return Object.freeze({ ...message, source: Object.freeze({ ...message.source, principal: deepFreeze(principal) }) })
}

/** Source kind of the sender notice before each Telegram prompt. */
export const SENDER_NOTICE_KIND = 'telegram-sender'

/**
 * The line that tells the model who wrote a Telegram message. Several allowed
 * users can talk to the same bot, each in their own chat.
 * @param principal - a `telegram-user` principal.
 * @returns a one-line label, or undefined for any other principal.
 */
export function senderLabel(principal) {
  if (principal?.kind !== 'telegram-user' || principal.id === undefined) return undefined
  const details = []
  if (nonEmpty(principal.username) !== undefined) details.push(`@${principal.username}`)
  details.push(`user id ${principal.id}`)
  const name = nonEmpty(principal.name)
  return name !== undefined ? `[Telegram message from ${name} (${details.join(', ')})]` : `[Telegram message from ${details.join(', ')}]`
}

/**
 * The notice that names the sender of a prompt, for the step the prompt
 * enters: its own message with a producer source, so DSH's title input and
 * readers of human messages see only what the person wrote.
 * @param message - a user message entering a step.
 * @returns the notice, or undefined when the message has no Telegram sender.
 */
export function senderNotice(message) {
  if (message?.source?.kind !== 'user') return undefined
  const text = senderLabel(message.source.principal)
  if (text === undefined) return undefined
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: SENDER_NOTICE_KIND, form: 'notice', summary: text },
  })
}

function deepFreeze(value) {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * Principals for prompts the bot hands to DSH's session controller, which
 * builds the message itself. The bot remembers the sender by request id
 * before the hand-over; `preStep`, an `agent/pre-step` listener, records it
 * on the message as it enters a step, so it is in the session log with the
 * message (DSH lets that hook replace the messages of a step).
 * @param limit - most principals remembered at once.
 */
export function createPrincipalTagger(limit = MAX_PENDING_PRINCIPALS) {
  const pending = new Map()
  return {
    /** Remember the sender of the prompt with this request id. */
    remember(requestId, principal) {
      if (typeof requestId !== 'string' || principal === undefined) return
      pending.delete(requestId)
      pending.set(requestId, principal)
      if (pending.size > limit) pending.delete(pending.keys().next().value)
    },
    /** Pending principals, for tests. */
    get size() {
      return pending.size
    },
    /**
     * `agent/pre-step` listener: record remembered senders on the step's
     * messages and put each Telegram sender's notice before their prompt.
     */
    async preStep(_payload, next) {
      const decision = await next()
      if (decision?.kind !== 'enter' || !Array.isArray(decision.messages)) return decision
      let changed = false
      const messages = []
      for (const original of decision.messages) {
        let message = original
        const rpcId = message?.source?.kind === 'user' ? message.source.rpcId : undefined
        const principal = typeof rpcId === 'string' ? pending.get(rpcId) : undefined
        if (principal !== undefined && message.source.principal === undefined) {
          pending.delete(rpcId)
          message = withPrincipal(message, principal)
          changed = true
        }
        const notice = senderNotice(message)
        if (notice !== undefined) {
          messages.push(notice)
          changed = true
        }
        messages.push(message)
      }
      return changed ? { ...decision, messages } : decision
    },
  }
}
