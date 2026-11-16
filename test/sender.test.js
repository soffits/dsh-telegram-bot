import './setup-home.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPrincipalTagger, senderLabel, senderNotice, senderSession, sendPrincipal, telegramUserPrincipal, withPrincipal } from '../src/sender.js'

test('a Telegram user principal names the user and the topic, without empty fields', () => {
  assert.deepEqual(
    telegramUserPrincipal({ id: 42, first_name: 'Ana', last_name: ' ', username: 'ana' }, { chatId: 100, threadId: 7001, topic: 'Notify' }),
    { kind: 'telegram-user', channel: 'telegram', id: '42', name: 'Ana', username: 'ana', chat: { id: '100', thread: 7001, name: 'Notify' } },
  )
  assert.deepEqual(telegramUserPrincipal({ id: 7 }, { chatId: 7 }), { kind: 'telegram-user', channel: 'telegram', id: '7', chat: { id: '7' } })
  assert.equal(telegramUserPrincipal(undefined), undefined)
  assert.equal(telegramUserPrincipal({ first_name: 'no id' }), undefined)
})

test('a send names its job, else its session, else its label', () => {
  assert.deepEqual(sendPrincipal({ job: 'Morning digest', jobId: 'job-1', sessionId: 's1' }), { kind: 'cron-job', channel: 'cron', id: 'job-1', name: 'Morning digest', sessionId: 's1' })
  assert.deepEqual(sendPrincipal({ job: 'Morning digest' }), { kind: 'cron-job', channel: 'cron', id: 'Morning digest', name: 'Morning digest' })
  assert.deepEqual(sendPrincipal({ sessionId: 's2', label: 'session s2' }), { kind: 'dsh-session', channel: 'dsh', id: 's2', name: 'session s2' })
  assert.deepEqual(sendPrincipal({ label: 'backup' }), { kind: 'external', channel: 'external', id: 'backup', name: 'backup' })
  assert.equal(sendPrincipal({ job: ' ', label: '' }), undefined)
  assert.equal(sendPrincipal(undefined), undefined)
})

test('withPrincipal keeps the message and freezes the copy', () => {
  const message = Object.freeze({ id: 'm', role: 'user', content: [], source: Object.freeze({ kind: 'user', rpcId: 'r' }) })
  const copy = withPrincipal(message, { kind: 'telegram-user', channel: 'telegram', id: '1' })
  assert.deepEqual(copy, { ...message, source: { kind: 'user', rpcId: 'r', principal: { kind: 'telegram-user', channel: 'telegram', id: '1' } } })
  assert.ok(Object.isFrozen(copy) && Object.isFrozen(copy.source) && Object.isFrozen(copy.source.principal))
  assert.equal(withPrincipal(message, undefined), message)
})

test('the tagger records a remembered sender once, on the matching request only', async () => {
  const tagger = createPrincipalTagger(2)
  const principal = { kind: 'telegram-user', channel: 'telegram', id: '42' }
  const ours = { id: 'a', role: 'user', content: [], source: { kind: 'user', rpcId: 'telegram:100:5' } }
  const other = { id: 'b', role: 'user', content: [], source: { kind: 'user', rpcId: 'web-1' } }
  const context = { id: 'c', role: 'user', content: [], source: { kind: 'time-context' } }
  tagger.remember('telegram:100:5', { principal })
  const enter = (messages) => tagger.preStep({ messages }, async () => ({ kind: 'enter', messages }))
  const decision = await enter([context, ours, other])
  assert.equal(decision.messages[0], context)
  assert.equal(decision.messages[1].source.kind, 'telegram-sender', 'the sender notice goes right before the prompt')
  assert.equal(decision.messages[1].content[0].text, '[Telegram message from user id 42]')
  assert.deepEqual(decision.messages[2].source.principal, principal)
  assert.equal(decision.messages[2].id, 'a')
  assert.equal(decision.messages[2].content.length, 0, 'the prompt itself is unchanged')
  assert.equal(decision.messages[3], other)
  assert.equal(tagger.size, 0)
  const again = [ours]
  assert.equal((await enter(again)).messages[0], ours)
  // Rejected steps pass through and keep what is remembered.
  tagger.remember('telegram:100:6', { principal })
  assert.deepEqual(await tagger.preStep({ messages: [] }, async () => ({ kind: 'reject' })), { kind: 'reject' })
  assert.equal(tagger.size, 1)
  // The oldest entry goes past the bound.
  tagger.remember('x', { principal })
  tagger.remember('y', { principal })
  assert.equal(tagger.size, 2)
})

test('the sender line says when the message was sent, with or without a known sender', () => {
  const ana = { kind: 'telegram-user', channel: 'telegram', id: '42', name: 'Ana', username: 'ana' }
  const sentAt = 'Mon 2026-03-02 09:41 UTC+01:00'
  assert.equal(senderLabel(ana, sentAt), '[Telegram message from Ana (@ana, user id 42), sent Mon 2026-03-02 09:41 UTC+01:00]')
  assert.equal(senderLabel(ana), '[Telegram message from Ana (@ana, user id 42)]')
  assert.equal(senderLabel(undefined, sentAt), '[Telegram message, sent Mon 2026-03-02 09:41 UTC+01:00]')
  assert.equal(senderLabel(undefined, ' '), undefined)
  const prompt = { id: 'p', role: 'user', content: [], source: { kind: 'user', principal: ana } }
  const notice = senderNotice(prompt, { context: '[Forwarded message from Kim]', sentAt })
  assert.equal(notice.content[0].text, `[Telegram message from Ana (@ana, user id 42), sent ${sentAt}]\n[Forwarded message from Kim]`)
  assert.equal(notice.source.summary, `[Telegram message from Ana (@ana, user id 42), sent ${sentAt}]`)
  assert.equal(senderNotice({ ...prompt, source: { kind: 'time-context' } }, { sentAt }), undefined)
})

test('the tagger keeps a send time remembered without a sender', async () => {
  const tagger = createPrincipalTagger()
  tagger.remember('telegram:1:2', { sentAt: 'Tue 2026-03-03 07:15 UTC+01:00' })
  const prompt = { id: 'p', role: 'user', content: [], source: { kind: 'user', rpcId: 'telegram:1:2' } }
  const decision = await tagger.preStep({}, async () => ({ kind: 'enter', messages: [prompt] }))
  assert.equal(decision.messages[0].content[0].text, '[Telegram message, sent Tue 2026-03-03 07:15 UTC+01:00]')
  assert.equal(decision.messages[1], prompt)
  tagger.remember('nothing', {})
  assert.equal(tagger.size, 0)
})

test('only a dsh-session principal names a sending session', () => {
  assert.equal(senderSession({ kind: 'dsh-session', channel: 'dsh', id: 'session-1' }), 'session-1')
  assert.equal(senderSession({ kind: 'dsh-session', channel: 'dsh', id: ' ' }), undefined)
  assert.equal(senderSession({ kind: 'oidc-user', channel: 'web', id: 'sub' }), undefined)
  assert.equal(senderSession(undefined), undefined)
})
