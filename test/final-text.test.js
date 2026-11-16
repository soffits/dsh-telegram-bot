import './setup-home.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { answerSegments, messageAnswer, turnAnswer } from '../src/final-text.js'

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

test('a message sent into a running turn splits its answers; context messages do not', () => {
  const user = (id, kind = 'user') => ({ type: 'user/message', data: { id, role: 'user', content: [text(id)], source: { kind } } })
  const events = [
    { type: 'turn/start', data: { turn: 2 } },
    user('prompt'),
    user('clock', 'time-context'),
    message(2, text('Let me look.'), call),
    message(2, text('First answer.')),
    user('posted', 'telegram-post'),
    user('also this'),
    message(2, text('Answer to the interjection.')),
    { type: 'turn/end', data: { turn: 2 } },
    user('next prompt'),
    message(3, text('Next turn.')),
  ]
  assert.deepEqual(answerSegments(events, 2), ['First answer.', 'Answer to the interjection.'])
  assert.equal(turnAnswer(events, 2), 'Answer to the interjection.')
  assert.deepEqual(answerSegments(events.slice(0, 7), 2), ['First answer.', ''], 'just taken: nothing below it yet')
  assert.deepEqual(answerSegments(events, 3), ['Next turn.'])
})
