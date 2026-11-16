import './setup-home.js'
// The Web client's handling of topic-send records, run without a browser:
// client.js registers its factory with window.__ModuleLoader__, so the test
// supplies that loader, a tiny React stand-in and the primitives it uses.
// Records with a sender are drawn by dsh-message-context and new records
// without one by Chat's notice row; this client only claims old records.
import assert from 'node:assert/strict'
import test from 'node:test'

let factory
globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } }
await import('../client.js')

const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useMemo: (make) => make(),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}
const primitives = { Button: 'Button', SettingsSecretField: 'SettingsSecretField', Switch: 'Switch' }
const client = factory((name) => {
  if (name === 'react') return react
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected module ${name}`)
})

const t = (key) => key

function postEvent({ source, content, surfaceOp = 'append', seq = 12 }) {
  return { type: 'user/message', seq, time: Date.UTC(2026, 10, 13, 22, 5), surfaceOp, data: { id: 'msg-1', role: 'user', content, source } }
}

const legacySource = { kind: 'user', rpcId: 'telegram-post:abc' }
const newSource = { kind: 'telegram-post', form: 'notice', summary: 'Sent to the Telegram topic "Notify" by job "Check-in"', principal: { kind: 'cron-job', channel: 'cron', id: 'Check-in', name: 'Check-in' } }

test('only records from before the post source kind are claimed', () => {
  const match = client.legacyPostDefinition.match['user/message']
  const content = [{ type: 'text', text: '[Sent to the Telegram topic "Notify"]\nhi' }]
  assert.equal(client.legacyPostDefinition.target, 'chat')
  assert.deepEqual(match(postEvent({ source: legacySource, content })), { id: 'msg-1', role: 'start', exclusive: true })
  assert.equal(match(postEvent({ source: newSource, content })), null, 'new records are drawn by their principal elsewhere, or by Chat')
  assert.equal(match(postEvent({ source: { kind: 'user', rpcId: 'web-1' }, content })), null, 'what the user typed stays a user bubble')
  assert.equal(match(postEvent({ source: { kind: 'user' }, content })), null)
  assert.equal(match(postEvent({ source: legacySource, content, surfaceOp: 'replace' })), null, 'a compaction copy is not drawn')
  assert.equal(match({ type: 'assistant/message', seq: 3, data: {} }), null)
})

test('an old record becomes Chat\'s own notice row, summarised by its header line', () => {
  const definition = client.legacyPostDefinition
  const content = [{ type: 'text', text: '[Sent to the Telegram topic "Notify" by job "Check-in"]\nBackup **done**' }]
  const event = postEvent({ source: legacySource, content })
  const stepLocation = { kind: 'step', turn: { turn: 4 }, step: { step: 2 } }
  const state = definition.start({}, { event, role: 'start', location: stepLocation }, {})
  assert.deepEqual(state, {
    kind: 'context',
    seq: 12,
    time: event.time,
    content,
    source: { kind: 'telegram-post', form: 'notice', summary: 'Sent to the Telegram topic "Notify" by job "Check-in"' },
    producer: { role: 'inject', label: 'telegram-post' },
    form: 'notice',
  })
  const node = definition.buildViewNode({ key: 'k-1', id: 'msg-1', state, start: { event, location: stepLocation }, matches: [] })
  assert.equal(node.kind, 'context')
  assert.equal(node.groupTree, 'turn')
  assert.equal(node.visibility, 'visible')
  const idle = definition.buildViewNode({ key: 'k-2', id: 'msg-2', state, start: { event, location: { kind: 'session' } }, matches: [] })
  assert.equal(idle.groupTree, undefined, 'a record between turns has no Turn to stay in')
  assert.equal(definition.buildViewNode({ key: 'k-3', id: 'x', state: undefined, matches: [] }), null)
  const bare = definition.start({}, { event: postEvent({ source: legacySource, content: [] }) }, {})
  assert.equal(bare.source.summary, 'Sent to Telegram')
})

test('apply registers only the old-record Definition, and no Chat renderer of its own', () => {
  const registered = []
  const definitions = []
  const ctx = {
    locale: { bind: () => t, register: () => () => {}, addLanguage: () => () => {} },
    effect: (fn) => fn(),
    configForms: { get: () => ({}), whileServed: () => () => {} },
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => {
        registered.push([options, component])
        return () => {}
      },
    },
    inject: (names, callback) => {
      assert.deepEqual(names, ['uiConversation'])
      callback({ uiConversation: { events: { register: (definition) => definitions.push(definition) } } })
    },
  }
  client.apply(ctx)
  assert.deepEqual(definitions, [client.legacyPostDefinition])
  assert.equal(registered.find(([options]) => options.name === 'conversation.chat.node'), undefined)
})
