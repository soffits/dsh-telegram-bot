import './setup-home.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { composePrompt, describeForward, isForwarded, repliedMessage, replyInfo, replyReference, withSent } from '../src/message-context.js'

const user = { id: 42, first_name: 'Owner' }

test('a reply keeps the text as sent and records what it replies to', () => {
  const words = Array.from({ length: 400 }, (_, index) => `word${index}`).join(' ')
  const { text, replyTo, forwardedFrom } = composePrompt({
    from: user,
    text: 'summary?',
    reply_to_message: { message_id: 3, date: 0, from: { id: 9, first_name: 'Kim', username: 'kim' }, text: words },
  })
  assert.equal(text, 'summary?', 'the prompt is only what the person wrote')
  assert.equal(forwardedFrom, undefined)
  assert.deepEqual(replyTo, { from: { kind: 'telegram-user', channel: 'telegram', id: '9', name: 'Kim', username: 'kim' }, sentAt: 0, text: words })
})

test('the user replying to their own forwarded message', () => {
  const reply = replyInfo({
    from: user,
    text: 'see above',
    reply_to_message: {
      message_id: 4,
      date: 0,
      from: user,
      text: 'meeting moved',
      forward_origin: { type: 'chat', sender_chat: { id: -1009, title: 'Team' }, author_signature: 'Lee', date: 60 },
    },
  })
  assert.deepEqual(reply, {
    from: { role: 'sender' },
    sentAt: 0,
    text: 'meeting moved',
    details: ['forwarded from "Team", signed Lee, originally sent Thu 1970-01-01 00:01 UTC+00:00'],
  })
})

test('a reply to another chat records the quote, origin and link', () => {
  const reply = replyInfo({
    from: user,
    text: 'thoughts?',
    quote: { text: 'prices go up in May' },
    external_reply: {
      origin: { type: 'channel', chat: { id: -1005551234, title: 'Private Notes', type: 'channel' }, message_id: 12, date: 0 },
      chat: { id: -1005551234, title: 'Private Notes', type: 'channel' },
      message_id: 12,
      document: { file_id: 'd1', file_name: 'plan.pdf', file_size: 30 * 1024 * 1024 },
    },
  }, { replyFile: 'too-large' })
  assert.deepEqual(reply, {
    from: { name: 'channel "Private Notes"' },
    sentAt: 0,
    text: 'prices go up in May',
    quoted: true,
    details: ['in another chat', 'https://t.me/c/5551234/12', 'contains a file "plan.pdf", too large to attach'],
  })
})

test('a reply to another chat without a quote says the text is not visible', () => {
  const reply = replyInfo({ from: user, text: 'x', external_reply: { origin: { type: 'hidden_user', sender_user_name: 'Pat', date: 0 } } })
  assert.deepEqual(reply.from, { name: 'Pat (account hidden)' })
  assert.match(reply.details.at(-1), /^the bot cannot see the text/u)
  assert.equal(reply.text, undefined)
})

test('legacy forward fields are still understood', () => {
  const message = { from: user, text: 'old style', forward_from: { id: 5, first_name: 'Robin', is_bot: true }, forward_date: 0 }
  assert.equal(isForwarded(message), true)
  assert.deepEqual(composePrompt(message), {
    text: 'old style',
    replyTo: undefined,
    forwardedFrom: { from: { kind: 'telegram-user', channel: 'telegram', id: '5', name: 'Robin' }, sentAt: 0, details: ['written by a bot'] },
  })
  assert.equal(describeForward(message), '[Forwarded message from Robin, a bot (originally sent Thu 1970-01-01 00:00 UTC+00:00)]')
})

test('a forwarded photo notes the attachment and keeps an empty caption out', () => {
  const message = { from: user, photo: [{ file_id: 'p' }], forward_origin: { type: 'user', sender_user: user, date: 0 } }
  assert.deepEqual(composePrompt(message, { ownFile: true }), {
    text: '',
    replyTo: undefined,
    forwardedFrom: { from: { role: 'sender' }, sentAt: 0, details: ['contains a photo, attached'] },
  })
})

test('plain messages and topic roots carry no envelope', () => {
  assert.deepEqual(composePrompt({ from: user, text: 'hi' }), { text: 'hi', replyTo: undefined, forwardedFrom: undefined })
  const inTopic = { from: user, text: 'hi', is_topic_message: true, message_thread_id: 70, reply_to_message: { message_id: 70, date: 0, text: 'topic' } }
  assert.equal(repliedMessage(inTopic), undefined)
  assert.deepEqual(composePrompt(inTopic), { text: 'hi', replyTo: undefined, forwardedFrom: undefined })
})

const sentEntry = {
  chatId: 100,
  messageIds: [7, 8],
  sentAt: '2026-11-08T18:03:22.000Z',
  text: 'Part one.\nPart two.',
  files: ['report.pdf'],
  fromSession: 'session-sender',
  job: 'Morning digest',
  boundSession: 'session-old',
  recorded: true,
}

test('a reply to a message sent on behalf of a job records the full text and its sender', () => {
  const message = { from: user, text: 'done', chat: { id: 100 }, reply_to_message: { message_id: 8, date: 0, from: { id: 1, is_bot: true, first_name: 'bot' }, text: 'Part two.' } }
  const { text, replyTo } = composePrompt(message, { botId: 1, sent: sentEntry, currentSession: 'session-new' })
  assert.equal(text, 'done')
  assert.deepEqual(replyTo, {
    from: { kind: 'cron-job', channel: 'cron', id: 'Morning digest', name: 'Morning digest' },
    sentAt: Date.parse('2026-11-08T18:03:22.000Z'),
    text: 'Part one.\nPart two.',
    details: [
      'posted by the bot on behalf of another sender',
      '2 Telegram messages',
      'with file "report.pdf"',
      'recorded in session session-old, not this one',
      'for more context, open session session-sender or session-old',
    ],
  })
  assert.deepEqual(replyReference(message), { chatId: 100, messageId: 8 })
})

test('a sent message recorded in the current session names its sender and keeps the reply facts', () => {
  const reply = { from: { role: 'assistant' }, sentAt: 0, text: 'Part two.', details: ['contains a photo, attached'] }
  const merged = withSent(reply, { ...sentEntry, files: [], messageIds: [8], fromSession: null, job: null, label: 'backup', boundSession: 'session-new', textCut: 12 }, { currentSession: 'session-new' })
  assert.deepEqual(merged, {
    from: { kind: 'external', channel: 'external', id: 'backup', name: 'backup' },
    sentAt: Date.parse('2026-11-08T18:03:22.000Z'),
    text: 'Part one.\nPart two.\n[…12 more characters not kept]',
    details: ['posted by the bot on behalf of another sender', 'contains a photo, attached'],
  })
})

test('no sent entry keeps the reply, and forwards have no reply reference', () => {
  const message = { from: user, text: 'ok', chat: { id: 100 }, reply_to_message: { message_id: 9, date: 0, from: { id: 1 }, text: 'hi' } }
  assert.deepEqual(composePrompt(message, { botId: 1 }).replyTo, { from: { role: 'assistant' }, sentAt: 0, text: 'hi' })
  assert.equal(replyReference({ ...message, forward_origin: { type: 'hidden_user', sender_user_name: 'x', date: 0 } }), undefined)
  assert.equal(replyReference({ from: user, text: 'plain' }), undefined)
})

test('a reply to a story', () => {
  assert.deepEqual(replyInfo({ from: user, text: 'nice', reply_to_story: { id: 1 } }), { details: ['a Telegram story'] })
})
