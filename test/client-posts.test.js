import './setup-home.js'
// The Web client's transcript rows for topic sends, run without a browser:
// client.js registers its factory with window.__ModuleLoader__, so the test
// supplies that loader, a tiny React stand-in and the primitives it uses.
import assert from 'node:assert/strict'
import test from 'node:test'

let factory
globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } }
await import('../client.js')

/** React stand-in: elements are plain objects, hooks run inline. */
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useMemo: (make) => make(),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}
const primitives = { Button: 'Button', SettingsSecretField: 'SettingsSecretField', Switch: 'Switch', MarkdownText: 'MarkdownText', IconPaperPlaneOutlineRegular: 'PaperPlane' }
const client = factory((name) => {
  if (name === 'react') return react
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected module ${name}`)
})

const t = (key) => key
const image = { id: 'img-1', name: 'cat.png', mediaType: 'image/png' }
const file = { id: 'file-1', name: 'notes.txt' }

/** A recorded post as DSH logs it. */
function postEvent({ source, content, surfaceOp = 'append', seq = 12 }) {
  return { type: 'user/message', seq, time: Date.UTC(2026, 10, 13, 22, 5), surfaceOp, data: { id: 'msg-1', role: 'user', content, source } }
}

const newSource = { kind: 'telegram-post', form: 'notice', summary: 'Sent to the Telegram topic "Notify" by job "Check-in" from session s-job', threadId: 7100, topic: 'Notify', job: 'Check-in', label: null, fromSession: 's-job', self: false }
const legacySource = { kind: 'user', rpcId: 'telegram-post:abc' }

test('posts are claimed on the Chat target, old and new, and nothing else is', () => {
  const match = client.postDefinition.match['user/message']
  assert.equal(client.postDefinition.target, 'chat')
  const content = [{ type: 'text', text: '[Sent to the Telegram topic "Notify"]\nhi' }]
  assert.deepEqual(match(postEvent({ source: newSource, content })), { id: 'msg-1', role: 'start', exclusive: true })
  assert.deepEqual(match(postEvent({ source: legacySource, content })), { id: 'msg-1', role: 'start', exclusive: true })
  assert.equal(match(postEvent({ source: { kind: 'user', rpcId: 'web-1' }, content })), null, 'what the user typed stays a user bubble')
  assert.equal(match(postEvent({ source: { kind: 'user' }, content })), null)
  assert.equal(match(postEvent({ source: { kind: 'telegram-topic', form: 'notice', summary: 'Topic renamed' }, content })), null, 'bot notes keep their notice row')
  assert.equal(match(postEvent({ source: newSource, content, surfaceOp: 'replace' })), null, 'a compaction copy is not drawn')
  assert.equal(match({ type: 'assistant/message', seq: 3, data: {} }), null)
})

test('the body loses its header and sticker lines; pictures and files are kept apart', () => {
  const post = client.readPost([
    { type: 'text', text: '[Sent to the Telegram topic "Notify" by this session]\nBackup **done**\n[Sticker 😻 from cats]' },
    { type: 'image', attachment: image },
    { type: 'file', attachment: file },
  ], legacySource)
  assert.equal(post.text, 'Backup **done**')
  assert.deepEqual(post.stickers, ['😻 from cats'])
  assert.deepEqual(post.images, [{ attachment: image, label: 'cat.png' }])
  assert.deepEqual(post.files, [file])
  assert.equal(post.meta.self, true)
  assert.equal(post.meta.topic, 'Notify')
})

test('old records get their sender from the header line the model reads', () => {
  const meta = (header) => client.readPost([{ type: 'text', text: `[${header}]\nx` }], legacySource).meta
  assert.deepEqual(meta('Sent to the Telegram topic "Notify" by job "Check-in" from session s-job'), { topic: 'Notify', threadId: null, job: 'Check-in', label: null, fromSession: 's-job', self: false })
  assert.deepEqual(meta('Sent to the Telegram topic 7100 by session s-2'), { topic: null, threadId: 7100, job: null, label: null, fromSession: 's-2', self: false })
  assert.deepEqual(meta('Sent to the Telegram topic "Alerts" by backup job'), { topic: 'Alerts', threadId: null, job: null, label: 'backup job', fromSession: null, self: false })
  assert.deepEqual(meta('Sent to the Telegram topic "Alerts"'), { topic: 'Alerts', threadId: null, job: null, label: null, fromSession: null, self: false })
})

test('the header names the topic and a job, and leaves the session\'s own sends unlabelled', () => {
  assert.deepEqual(client.postLabels(client.readPost([], newSource).meta, t), { where: 'Notify', who: 'postJob Check-in', whoTitle: 'postSession s-job' })
  assert.deepEqual(client.postLabels({ topic: null, threadId: 7100, job: null, label: null, fromSession: 's-1', self: true }, t), { where: 'postTopic 7100', who: null, whoTitle: undefined })
  assert.deepEqual(client.postLabels({ topic: 'N', threadId: 1, job: null, label: null, fromSession: 's-2', self: false }, t), { where: 'N', who: 'postOtherSession', whoTitle: 'postSession s-2' })
})

test('a post becomes one visible Chat row that stays outside the folded work rows', () => {
  const definition = client.postDefinition
  const event = postEvent({ source: newSource, content: [{ type: 'text', text: '[Sent to the Telegram topic "Notify"]\nhi' }, { type: 'image', attachment: image }] })
  const stepLocation = { kind: 'step', turn: { turn: 4 }, step: { step: 2 } }
  const state = definition.start({}, { event, role: 'start', location: stepLocation }, {})
  const node = definition.buildViewNode({ key: 'k-1', id: 'msg-1', state, start: { event, location: stepLocation }, matches: [] })
  assert.equal(node.kind, 'telegram-post')
  assert.equal(node.target, 'chat')
  assert.equal(node.anchorSeq, 12)
  assert.equal(node.visibility, 'visible')
  assert.equal(node.groupTree, 'turn')
  assert.equal(node.data.text, 'hi')
  const idle = definition.buildViewNode({ key: 'k-2', id: 'msg-2', state, start: { event, location: { kind: 'session' } }, matches: [] })
  assert.equal(idle.groupTree, undefined, 'a post between turns has no Turn to stay in')
  assert.equal(definition.buildViewNode({ key: 'k-3', id: 'x', state: undefined, matches: [] }), null)
})

/** Every string and element type in a rendered tree, depth first. */
function flatten(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (typeof node.type === 'string' || typeof node.type === 'function') out.push(node)
  for (const child of node.children ?? []) flatten(child, out)
  return out
}

test('the row shows the header, the text as Markdown and the pictures through the shared gallery', () => {
  const event = postEvent({ source: newSource, content: [{ type: 'text', text: '[Sent to the Telegram topic "Notify" by job "Check-in" from session s-job]\nBackup **done**' }, { type: 'image', attachment: image }, { type: 'file', attachment: file }] })
  const data = client.postDefinition.start({}, { event, role: 'start', location: { kind: 'session' } }, {})
  const factoryCalls = []
  const loadImage = async () => 'blob:x'
  const tree = client.TelegramPostView({
    node: { kind: 'telegram-post', data },
    loadImage,
    t,
    renderFactorySlot: (name, props) => {
      factoryCalls.push([name, props])
      return { type: 'gallery', props, children: [] }
    },
  })
  assert.equal(tree.props['data-telegram-post'], true)
  const parts = flatten(tree)
  const strings = parts.filter((part) => typeof part === 'string')
  assert.ok(strings.includes('postTitle'))
  assert.ok(strings.includes('Notify'))
  assert.ok(strings.includes('postJob Check-in'))
  assert.ok(strings.includes('📎 notes.txt'))
  const markdown = parts.find((part) => part.type === 'MarkdownText')
  assert.equal(markdown.props.text, 'Backup **done**')
  assert.equal(markdown.props.labels.code.copyLabel, 'postCopy')
  assert.deepEqual(factoryCalls, [['conversation.images.content', { images: [{ attachment: image, label: 'cat.png' }], loadImage, align: 'start' }]])
  assert.ok(!strings.some((text) => text.includes('[Sent to the Telegram')), 'the header line is not repeated in the body')
})

test('apply registers the Definition with the conversation service and the renderer in the Chat node slot', () => {
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
  assert.deepEqual(definitions, [client.postDefinition])
  const node = registered.find(([options]) => options.name === 'conversation.chat.node')
  assert.deepEqual(node[0], { name: 'conversation.chat.node', key: 'telegram-post', locale: 'telegram-bot' })
  assert.equal(node[1], client.TelegramPostView)
})
