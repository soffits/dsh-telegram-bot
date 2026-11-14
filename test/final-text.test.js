import './setup-home.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { messageAnswer, turnAnswer } from '../src/final-text.js'

const text = (value) => ({ type: 'text', text: value })
const call = { type: 'tool-call', id: 'c1', name: 'bash', input: {} }
const message = (turn, ...content) => ({ type: 'assistant/message', data: { turn, message: { content } } })

test('a message that calls a tool holds no answer; otherwise its last text block is the answer', () => {
  assert.equal(messageAnswer({ content: [text('Now the board entries.'), call] }), '')
  assert.equal(messageAnswer({ content: [text('Checking.'), text('All done.')] }), 'All done.')
  assert.equal(messageAnswer({ content: [] }), '')
  assert.equal(messageAnswer(undefined), '')
})

test('a turn keeps the answers of its tool-free messages, in order', () => {
  const events = [
    message(1, text('Old turn.')),
    { type: 'turn/start', data: { turn: 2 } },
    message(2, text('Let me look.'), call),
    { type: 'tool/result', data: { turn: 2 } },
    message(2, text('First answer.')),
    message(2, text('Narration.'), text('Answer to the steer.')),
  ]
  assert.equal(turnAnswer(events, 2), 'First answer.\n\nAnswer to the steer.')
  assert.equal(turnAnswer(events, 3), '')
  assert.equal(turnAnswer(undefined, 2), '')
})
