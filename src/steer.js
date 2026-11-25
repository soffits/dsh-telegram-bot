/**
 * Steering: a Telegram message sent while the bound session's turn runs goes
 * into that turn, the way the DSH Web UI sends a message during a turn. DSH
 * delivers it at the agent's next step; if the turn has already ended, DSH
 * opens a new turn for it. Fork-only code, kept out of `app.js`.
 */
import { randomUUID } from 'node:crypto'
import { admitPrompt, removePending } from '@soffits/dsh-plugin-sdk/channel'
import { promptRequestId } from './admission.js'

/** Reaction that tells the sender a message reached the running turn. */
export const STEER_REACTION = '👀'

/**
 * How Telegram messages that arrive during a running turn are handled.
 * @param value - the `busyMessages` setting.
 * @returns `queue` (the bot holds them until the turn ends) or `steer`.
 */
export function busyMode(value) {
  return value === 'queue' ? 'queue' : 'steer'
}

/**
 * The durable request id of a Telegram prompt. With a Telegram message id it is
 * the same id the native text path uses, so a redelivered update is not
 * admitted twice.
 * @param chatId - Telegram chat.
 * @param messageId - Telegram message id, when known.
 * @returns the request id recorded on the user message.
 */
export function steerRequestId(chatId, messageId) {
  return Number.isSafeInteger(chatId) && Number.isSafeInteger(messageId)
    ? promptRequestId(chatId, messageId)
    : `telegram-steer:${randomUUID()}`
}

/**
 * Send one prompt into the session's running turn. Text goes through the
 * Session controller's `steer` mode, the Web UI's own path; attachments are
 * already stored, so a message with them goes straight to `agent.steer`, the
 * method that mode calls. Either way DSH puts the message in the next-step
 * inbox and wakes the agent: a running turn takes it at its next step, and a
 * turn that ended meanwhile is followed by a new one, so the message is never
 * dropped. A request id already admitted is skipped, so it is never sent twice.
 * @param ctx - plugin context.
 * @param agent - the session's live agent.
 * @param prompt - `{ chatId, messageId, text, attachments, principal, envelope,
 *   clientTimeZone }`; `principal` is the sender and `envelope` the
 *   send time, reply and forward, both recorded on the message's source, and
 *   `clientTimeZone` is the sender's zone, recorded on the source for DSH's
 *   clock context.
 * @param signal - request lifetime.
 * @param tagger - remembers the metadata of a prompt the session controller
 *   builds (see `createPrincipalTagger`).
 * @returns the request id, or `undefined` when nothing was handed over (an
 *   empty prompt, or a DSH that cannot steer).
 */
export async function steerPrompt(ctx, agent, { chatId, messageId, text, attachments = [], principal, envelope, clientTimeZone }, signal, tagger) {
  const requestId = steerRequestId(chatId, messageId)
  const outcome = await admitPrompt(ctx, agent, { requestId, text, attachments, mode: 'steer', principal, envelope, clientTimeZone }, signal, tagger)
  return outcome === 'admitted' || outcome === 'known' ? requestId : undefined
}

/**
 * Remove Telegram messages from one chat that the agent has not taken yet,
 * from both the next-step and the next-turn inbox.
 * @param agent - the session's live agent.
 * @param chatId - Telegram chat whose messages are removed.
 * @returns how many were removed.
 */
export function clearTelegramInbox(agent, chatId) {
  const prefix = `telegram:${chatId}:`
  return removePending(agent, (requestId) => requestId.startsWith(prefix) || requestId.startsWith('telegram-steer:'))
}
