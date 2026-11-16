import './setup-home.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPrincipalTagger, senderSession, sendPrincipal, telegramUserPrincipal, withMetadata } from '../src/sender.js'

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

test('withMetadata keeps the message, freezes the copy and never overwrites a field', () => {
  const message = Object.freeze({ id: 'm', role: 'user', content: [], source: Object.freeze({ kind: 'user', rpcId: 'r' }) })
  const principal = { kind: 'telegram-user', channel: 'telegram', id: '1' }
  const envelope = { sentAt: 1000 }
  const copy = withMetadata(message, { principal, envelope })
  assert.deepEqual(copy, { ...message, source: { kind: 'user', rpcId: 'r', principal, envelope } })
  assert.ok(Object.isFrozen(copy) && Object.isFrozen(copy.source) && Object.isFrozen(copy.source.principal) && Object.isFrozen(copy.source.envelope))
  assert.equal(withMetadata(message, {}), message)
  assert.equal(withMetadata(copy, { principal: { kind: 'other', id: '2' }, envelope: { sentAt: 5 } }), copy, 'recorded fields win')
})

test('the tagger records remembered metadata once, on the matching request only, and adds no message', async () => {
  const tagger = createPrincipalTagger(2)
  const principal = { kind: 'telegram-user', channel: 'telegram', id: '42' }
  const envelope = { sentAt: 1_772_462_460_000, replyTo: { from: { role: 'assistant' }, text: 'hi' } }
  const ours = { id: 'a', role: 'user', content: [], source: { kind: 'user', rpcId: 'telegram:100:5' } }
  const other = { id: 'b', role: 'user', content: [], source: { kind: 'user', rpcId: 'web-1' } }
  const context = { id: 'c', role: 'user', content: [], source: { kind: 'time-context' } }
  tagger.remember('telegram:100:5', { principal, envelope })
  const enter = (messages) => tagger.preStep({ messages }, async () => ({ kind: 'enter', messages }))
  const decision = await enter([context, ours, other])
  assert.equal(decision.messages.length, 3, 'no notice: rendering is the renderer\'s job')
  assert.equal(decision.messages[0], context)
  assert.deepEqual(decision.messages[1].source.principal, principal)
  assert.deepEqual(decision.messages[1].source.envelope, envelope)
  assert.equal(decision.messages[1].id, 'a')
  assert.equal(decision.messages[1].content.length, 0, 'the prompt itself is unchanged')
  assert.equal(decision.messages[2], other)
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

test('the tagger keeps an envelope remembered without a sender', async () => {
  const tagger = createPrincipalTagger()
  tagger.remember('telegram:1:2', { envelope: { sentAt: 5000 } })
  const prompt = { id: 'p', role: 'user', content: [], source: { kind: 'user', rpcId: 'telegram:1:2' } }
  const decision = await tagger.preStep({}, async () => ({ kind: 'enter', messages: [prompt] }))
  assert.equal(decision.messages.length, 1)
  assert.deepEqual(decision.messages[0].source, { kind: 'user', rpcId: 'telegram:1:2', envelope: { sentAt: 5000 } })
  tagger.remember('nothing', {})
  assert.equal(tagger.size, 0)
})

test('only a dsh-session principal names a sending session', () => {
  assert.equal(senderSession({ kind: 'dsh-session', channel: 'dsh', id: 'session-1' }), 'session-1')
  assert.equal(senderSession({ kind: 'dsh-session', channel: 'dsh', id: ' ' }), undefined)
  assert.equal(senderSession({ kind: 'oidc-user', channel: 'web', id: 'sub' }), undefined)
  assert.equal(senderSession(undefined), undefined)
})
