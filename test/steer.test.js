import './setup-home.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { busyMode, clearTelegramInbox, hasPendingInput, steerPrompt } from '../src/steer.js'
import { createPrincipalTagger } from '../src/sender.js'

function fakeAgent(events = []) {
  return {
    steered: [],
    steer(message) { this.steered.push(message); this.inbox.nextStep.push(message) },
    inbox: {
      nextStep: [],
      nextTurn: [],
      remove(id) {
        for (const list of [this.nextStep, this.nextTurn]) {
          const index = list.findIndex((message) => message.id === id)
          if (index !== -1) list.splice(index, 1)
        }
      },
    },
    session: { snapshotEvents: () => events },
  }
}

const signal = new AbortController().signal

test('text is steered through the Session controller, as the Web UI does', async () => {
  const prompts = []
  const ctx = { get: (name) => (name === 'sessionController' ? { prompt: async (request) => { prompts.push(request); return { accepted: true } } } : undefined) }
  const agent = fakeAgent()
  const id = await steerPrompt(ctx, agent, { sessionId: 's', chatId: 100, messageId: 7, text: 'hi' }, signal)
  assert.equal(id, 'telegram:100:7')
  assert.deepEqual(prompts, [{ sessionId: 's', requestId: 'telegram:100:7', mode: 'steer', content: [{ type: 'text', text: 'hi' }] }])
  assert.equal(agent.steered.length, 0)
})

test('attachments go to agent.steer once per Telegram message', async () => {
  const ctx = { get: () => undefined }
  const image = { type: 'image', attachment: { attachmentId: 'a' } }
  const agent = fakeAgent()
  await steerPrompt(ctx, agent, { sessionId: 's', chatId: 100, messageId: 8, text: 'look', attachments: [image] }, signal)
  await steerPrompt(ctx, agent, { sessionId: 's', chatId: 100, messageId: 8, text: 'look', attachments: [image] }, signal)
  assert.equal(agent.steered.length, 1, 'a redelivered update is not sent twice')
  assert.deepEqual(agent.steered[0].content, [{ type: 'text', text: 'look' }, image])
  assert.equal(agent.steered[0].source.rpcId, 'telegram:100:8')
  // Already recorded in the session (taken by a step): skipped as well.
  const recorded = fakeAgent([{ type: 'user/message', data: { source: { kind: 'user', rpcId: 'telegram:100:9' } } }])
  await steerPrompt(ctx, recorded, { sessionId: 's', chatId: 100, messageId: 9, text: '', attachments: [image] }, signal)
  assert.equal(recorded.steered.length, 0)
})

test('a steered prompt records its sender and envelope on the source, on both paths', async () => {
  const principal = { kind: 'telegram-user', channel: 'telegram', id: '42', name: 'Ana' }
  const envelope = { sentAt: 1_772_444_460_000, replyTo: { from: { kind: 'telegram-user', id: '9', name: 'Kim' }, sentAt: 0, text: 'the plan' } }
  const enter = (message) => ({ kind: 'enter', messages: [message] })
  const prompts = []
  // Through the Session controller, which builds the message itself.
  const viaController = createPrincipalTagger()
  const ctx = { get: (name) => (name === 'sessionController' ? { prompt: async (request) => { prompts.push(request); return { accepted: true } } } : undefined) }
  await steerPrompt(ctx, fakeAgent(), { sessionId: 's', chatId: 100, messageId: 7, text: 'agreed', principal, envelope, clientTimeZone: 'Europe/Berlin' }, signal, viaController)
  assert.equal(prompts[0].clientTimeZone, 'Europe/Berlin')
  const built = { id: 'm1', role: 'user', content: [{ type: 'text', text: 'agreed' }], source: { kind: 'user', rpcId: 'telegram:100:7' } }
  const first = await viaController.preStep({}, async () => enter(built))
  assert.equal(first.messages.length, 1)
  assert.deepEqual(first.messages[0].source, { kind: 'user', rpcId: 'telegram:100:7', principal, envelope })
  assert.deepEqual(first.messages[0].content, [{ type: 'text', text: 'agreed' }], 'the text is as sent')
  // Straight into the agent's inbox, with an attachment: the source is complete from the start.
  const direct = createPrincipalTagger()
  const agent = fakeAgent()
  await steerPrompt({ get: () => undefined }, agent, { sessionId: 's', chatId: 100, messageId: 8, text: 'and this', attachments: [{ type: 'file' }], principal, envelope, clientTimeZone: 'Europe/Berlin' }, signal, direct)
  assert.deepEqual(agent.steered[0].source, { kind: 'user', rpcId: 'telegram:100:8', clientTimeZone: 'Europe/Berlin', principal, envelope })
  const second = await direct.preStep({}, async () => enter(agent.steered[0]))
  assert.equal(second.messages[0], agent.steered[0])
  // Without a zone the source and request are as before.
  prompts.length = 0
  await steerPrompt(ctx, fakeAgent(), { sessionId: 's', chatId: 100, messageId: 9, text: 'x' }, signal)
  assert.equal('clientTimeZone' in prompts[0], false)
})

test('without steer or send the caller keeps the message', async () => {
  assert.equal(await steerPrompt({ get: () => undefined }, {}, { sessionId: 's', chatId: 1, messageId: 1, text: 'x', attachments: [{ type: 'file' }] }, signal), undefined)
})

test('/clear helper removes only Telegram messages not yet taken', () => {
  const agent = fakeAgent()
  agent.inbox.nextStep.push({ id: 'a', source: { kind: 'user', rpcId: 'telegram:100:1' } }, { id: 'b', source: { kind: 'user', rpcId: 'web-1' } })
  agent.inbox.nextTurn.push({ id: 'c', source: { kind: 'user', rpcId: 'telegram:100:2' } }, { id: 'd', source: { kind: 'user', rpcId: 'telegram:200:2' } })
  assert.equal(hasPendingInput(agent), true)
  assert.equal(clearTelegramInbox(agent, 100), 2)
  assert.deepEqual([...agent.inbox.nextStep, ...agent.inbox.nextTurn].map((message) => message.id), ['b', 'd'])
  assert.equal(busyMode('queue'), 'queue')
  assert.equal(busyMode(undefined), 'steer')
})
