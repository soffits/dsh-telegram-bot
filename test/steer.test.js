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

test('a steered prompt keeps its context for the notice before it, on both paths', async () => {
  const principal = { kind: 'telegram-user', channel: 'telegram', id: '42', name: 'Ana' }
  const context = '[Replying to a message from Kim (sent Thu 1970-01-01 00:00 UTC+00:00)]\n> the plan'
  const enter = (message) => ({ kind: 'enter', messages: [message] })
  // Through the Session controller, which builds the message itself.
  const viaController = createPrincipalTagger()
  const ctx = { get: (name) => (name === 'sessionController' ? { prompt: async () => ({ accepted: true }) } : undefined) }
  await steerPrompt(ctx, fakeAgent(), { sessionId: 's', chatId: 100, messageId: 7, text: 'agreed', principal, context }, signal, viaController)
  const built = { id: 'm1', role: 'user', content: [{ type: 'text', text: 'agreed' }], source: { kind: 'user', rpcId: 'telegram:100:7' } }
  const first = await viaController.preStep({}, async () => enter(built))
  assert.equal(first.messages[0].content[0].text, `[Telegram message from Ana (user id 42)]\n${context}`)
  assert.deepEqual(first.messages[1].content, [{ type: 'text', text: 'agreed' }])
  // Straight into the agent's inbox, with an attachment.
  const direct = createPrincipalTagger()
  const agent = fakeAgent()
  await steerPrompt({ get: () => undefined }, agent, { sessionId: 's', chatId: 100, messageId: 8, text: 'and this', attachments: [{ type: 'file' }], principal, context }, signal, direct)
  const second = await direct.preStep({}, async () => enter(agent.steered[0]))
  assert.match(second.messages[0].content[0].text, /\n\[Replying to a message from Kim/u)
  assert.equal(second.messages[1].content[0].text, 'and this')
})

test('a steered prompt carries its send time in the notice and its zone on the source', async () => {
  const principal = { kind: 'telegram-user', channel: 'telegram', id: '42', name: 'Ana' }
  const sentAt = 'Mon 2026-03-02 09:41 UTC+01:00'
  const enter = (message) => ({ kind: 'enter', messages: [message] })
  const prompts = []
  const ctx = { get: (name) => (name === 'sessionController' ? { prompt: async (request) => { prompts.push(request); return { accepted: true } } } : undefined) }
  const viaController = createPrincipalTagger()
  await steerPrompt(ctx, fakeAgent(), { sessionId: 's', chatId: 100, messageId: 7, text: 'done?', principal, sentAt, clientTimeZone: 'Europe/Berlin' }, signal, viaController)
  assert.equal(prompts[0].clientTimeZone, 'Europe/Berlin')
  const built = { id: 'm1', role: 'user', content: [{ type: 'text', text: 'done?' }], source: { kind: 'user', rpcId: 'telegram:100:7' } }
  const first = await viaController.preStep({}, async () => enter(built))
  assert.equal(first.messages[0].content[0].text, `[Telegram message from Ana (user id 42), sent ${sentAt}]`)
  const direct = createPrincipalTagger()
  const agent = fakeAgent()
  await steerPrompt({ get: () => undefined }, agent, { sessionId: 's', chatId: 100, messageId: 8, text: 'look', attachments: [{ type: 'file' }], principal, sentAt, clientTimeZone: 'Europe/Berlin' }, signal, direct)
  assert.equal(agent.steered[0].source.clientTimeZone, 'Europe/Berlin')
  assert.equal(agent.steered[0].source.rpcId, 'telegram:100:8')
  const second = await direct.preStep({}, async () => enter(agent.steered[0]))
  assert.equal(second.messages[0].content[0].text, `[Telegram message from Ana (user id 42), sent ${sentAt}]`)
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
