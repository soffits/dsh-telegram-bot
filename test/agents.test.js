import './setup-home.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { agentsListText, boardText, childState, collectSubagents, createAgentBoards, formatElapsed, reportOf } from '../src/agents.js'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('elapsed times: whole minutes while running, seconds once finished', () => {
  assert.equal(formatElapsed(20_000, false), '<1m')
  assert.equal(formatElapsed(185_000, false), '3m')
  assert.equal(formatElapsed(20_000, true), '20s')
  assert.equal(formatElapsed(134_000, true), '2m 14s')
  assert.equal(formatElapsed(3_900_000, true), '1h 5m')
})

test('the board lists each subagent with model and time, and marks failures', () => {
  const start = 1_000_000
  const entries = [
    { label: 'Research prices', model: 'claude-opus-5-5', depth: 1, startedAt: start, endedAt: start + 134_000, stopReason: 'completed' },
    { label: 'Check stock', model: 'deepseek-flash', depth: 2, startedAt: start, endedAt: start + 20_000, stopReason: 'max_tokens' },
    { label: 'Compare reviews', model: '', depth: 1, startedAt: start, endedAt: undefined, stopReason: undefined },
  ]
  assert.equal(boardText(entries, start + 185_000), [
    '🤖 3 subagents · 1 running',
    '✓ Research prices · claude-opus-5-5 · 2m 14s',
    '↳ ✗ Check stock · deepseek-flash · 20s · max tokens',
    '⏳ Compare reviews · 3m',
  ].join('\n'))
  entries[2].endedAt = start + 200_000
  entries[2].stopReason = 'completed'
  assert.equal(boardText(entries, start + 300_000).split('\n')[0], '🤖 3 subagents · done, 1 failed')
  assert.equal(boardText([entries[0]], start).split('\n')[0], '🤖 1 subagent · all done')
})

test('a long board folds its oldest finished lines and keeps running ones', () => {
  const entries = Array.from({ length: 40 }, (_, index) => ({ label: `job ${index}`, model: '', depth: 1, startedAt: 0, endedAt: index === 0 ? undefined : 1000, stopReason: 'completed' }))
  const lines = boardText(entries, 1000).split('\n')
  assert.ok(lines.length <= 27, `${lines.length} lines`)
  assert.match(lines[1], /^… \d+ earlier finished$/u)
  assert.ok(lines.includes('⏳ job 0 · <1m'), 'the running line stays')
  assert.equal(lines.at(-1), '✓ job 39 · 1s')
})

test('the last report is the newest message sent to the parent or tool-free answer', () => {
  const sendCall = (message) => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Reporting now.' }, { type: 'tool-call', name: 'send_message', arguments: JSON.stringify({ agent_id: 'p', message }) }] } } })
  const answer = (text) => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })
  const toolOnly = { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Reading files.' }, { type: 'tool-call', name: 'bash', arguments: '{}' }] } } }
  assert.equal(reportOf([answer('early answer'), sendCall('Found three stores.'), toolOnly]), 'Found three stores.')
  assert.equal(reportOf([sendCall('progress'), answer('Final: all done.')]), 'Final: all done.')
  assert.equal(reportOf([{ type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', name: 'mcp__dsh__send_message', arguments: { message: 'prefixed tool' } }] } } }]), 'prefixed tool')
  assert.equal(reportOf([toolOnly]), '')
})

test('a listed subagent is running, done, failed, or interrupted by a restart', () => {
  const now = 10_000_000
  assert.deepEqual(childState({ status: 'running', timing: { settledMs: 1000, active: { since: now - 60_000, through: now } } }, now), { state: 'running', elapsedMs: 61_000 })
  assert.deepEqual(childState({ status: undefined, timing: { settledMs: 90_000, lastTurnCompleted: true } }, now), { state: 'done', elapsedMs: 90_000 })
  assert.deepEqual(childState({ status: 'idle', timing: { settledMs: 5000, lastTurnCompleted: false } }, now), { state: 'failed', elapsedMs: 5000 })
  assert.deepEqual(childState({ status: undefined, timing: { settledMs: 0, active: { since: now - 300_000, through: now - 120_000 } } }, now), { state: 'interrupted', elapsedMs: 180_000 })
})

test('/agents collects nested subagents, newest first, and always keeps running ones', async () => {
  const catalogs = new Map([
    ['root', Array.from({ length: 12 }, (_, index) => ({ id: `c${index}`, label: `child ${index}`, createdAt: 1000 + index, mode: 'one-shot' }))],
    ['c11', [{ id: 'g1', label: 'grandchild', createdAt: 2000, mode: 'one-shot' }]],
  ])
  const { rows, total } = await collectSubagents(async (id) => catalogs.get(id) ?? [], 'root', (id) => id === 'c0', 4)
  assert.equal(total, 13)
  assert.deepEqual(rows.map((row) => row.id), ['g1', 'c11', 'c10', 'c0'])
  assert.equal(rows[0].depth, 2)
})

test('/agents text shows state, model, time, age and the start of the report', () => {
  const now = 10_000_000
  const text = agentsListText([
    { label: 'Research prices', model: 'claude-opus-5-5', depth: 1, state: 'running', elapsedMs: 240_000, createdAt: now - 300_000, report: '' },
    { label: 'Check stock', model: 'deepseek-flash', depth: 2, state: 'done', elapsedMs: 75_000, createdAt: now - 7_200_000, report: `Found 3 stores\nwith it. ${'x'.repeat(400)}` },
  ], 12, now)
  const lines = text.split('\n')
  assert.equal(lines[0], '🤖 Subagents (latest 2 of 12):')
  assert.equal(lines[2], '⏳ Research prices')
  assert.equal(lines[3], '   running · claude-opus-5-5 · 4m · 5m ago')
  assert.equal(lines[5], '↳ ✓ Check stock')
  assert.equal(lines[6], '   done · deepseek-flash · 1m 15s · 2h ago')
  assert.match(lines[7], /^ {3}“Found 3 stores with it\. x+…”$/u)
  assert.ok(lines[7].length < 260)
  assert.equal(agentsListText([], 0, now), 'This session has started no subagents.')
})

/**
 * Boards against fake Telegram calls. `sessions` maps a session id to its
 * parent; `topics` maps a bound session to its topic state.
 */
function makeBoards({ delayMs = 20, tickMs = 60_000, edit } = {}) {
  const parents = new Map()
  const topics = new Map()
  const labels = new Map()
  const posts = []
  const edits = []
  let clock = 1_000_000
  let nextId = 500
  const boards = createAgentBoards({
    parentOf: (id) => parents.get(id),
    topicOf: (id) => topics.get(id),
    turnOf: (topic) => (topic.busy ? topic.turn : undefined),
    labelOf: async (_parent, child) => labels.get(child),
    modelOf: async () => 'claude-opus-5-5',
    post: async (topic, text) => {
      nextId += 1
      posts.push({ topic: topic.key, id: nextId, text })
      return nextId
    },
    edit: async (topic, messageId, text) => {
      const outcome = edit?.(messageId, text) ?? 'ok'
      edits.push({ topic: topic.key, id: messageId, text, outcome })
      return outcome
    },
    reportError: (scope, error) => { throw new Error(`${scope}: ${error}`) },
    now: () => clock,
    delayMs,
    tickMs,
  })
  const topic = { key: '100:7001', busy: true, turn: 1 }
  topics.set('root', topic)
  return {
    boards, parents, topics, labels, posts, edits, topic,
    advance: (ms) => { clock += ms },
    child: (id, parent, label) => { parents.set(id, parent); if (label) labels.set(id, label) },
  }
}

test('subagents of a shown turn share one status message, edited as they start and finish', async () => {
  const t = makeBoards()
  try {
    t.child('a', 'root', 'Research prices')
    t.child('b', 'root', 'Check stock')
    await t.boards.onStart({ runId: 'r1', id: 'a' })
    await t.boards.onStart({ runId: 'r2', id: 'b' })
    await wait(60)
    assert.equal(t.posts.length, 1, 'starts close together share one message')
    assert.equal(t.posts[0].text, '🤖 2 subagents · 2 running\n⏳ Research prices · claude-opus-5-5 · <1m\n⏳ Check stock · claude-opus-5-5 · <1m')
    t.advance(30_000)
    t.boards.onEnd({ runId: 'r1', id: 'a', stopReason: 'completed' })
    await wait(60)
    assert.equal(t.edits.length, 1)
    assert.equal(t.edits[0].id, t.posts[0].id)
    assert.equal(t.edits[0].text, '🤖 2 subagents · 1 running\n✓ Research prices · claude-opus-5-5 · 30s\n⏳ Check stock · claude-opus-5-5 · <1m')
    t.boards.onEnd({ runId: 'r2', id: 'b', stopReason: 'cancelled' })
    await wait(60)
    assert.equal(t.edits.at(-1).text, '🤖 2 subagents · done, 1 failed\n✓ Research prices · claude-opus-5-5 · 30s\n✗ Check stock · claude-opus-5-5 · 30s · cancelled')
    assert.equal(t.boards.boards.size, 0, 'a finished board is frozen')
    // The next subagent, in the same turn or a later one, opens a new message.
    t.child('c', 'root', 'Summarize')
    await t.boards.onStart({ runId: 'r3', id: 'c' })
    await wait(60)
    assert.equal(t.posts.length, 2)
    assert.equal(t.edits.length, 2, 'the frozen message is not touched again')
  } finally {
    t.boards.dispose()
  }
})

test('nested subagents join their ancestor\'s board, even after the turn ended', async () => {
  const t = makeBoards()
  try {
    t.child('a', 'root', 'Plan the trip')
    await t.boards.onStart({ runId: 'r1', id: 'a' })
    await wait(60)
    t.topic.busy = false
    t.child('g', 'a', 'Find flights')
    await t.boards.onStart({ runId: 'r2', id: 'g' })
    await wait(60)
    assert.equal(t.posts.length, 1)
    assert.equal(t.edits.at(-1).text, '🤖 2 subagents · 2 running\n⏳ Plan the trip · claude-opus-5-5 · <1m\n↳ ⏳ Find flights · claude-opus-5-5 · <1m')
  } finally {
    t.boards.dispose()
  }
})

test('subagents of unbound sessions or of turns the topic is not showing stay quiet', async () => {
  const t = makeBoards()
  try {
    t.child('x', 'elsewhere', 'Other work')
    await t.boards.onStart({ runId: 'r1', id: 'x' })
    t.topic.busy = false
    t.child('y', 'root', 'Web turn work')
    await t.boards.onStart({ runId: 'r2', id: 'y' })
    await wait(60)
    assert.equal(t.posts.length, 0)
    assert.equal(t.boards.boards.size, 0)
  } finally {
    t.boards.dispose()
  }
})

test('a new turn gets its own board while the earlier one keeps running', async () => {
  const t = makeBoards()
  try {
    t.child('a', 'root', 'Long research')
    await t.boards.onStart({ runId: 'r1', id: 'a' })
    await wait(60)
    t.topic.turn = 2
    t.child('b', 'root', 'Quick check')
    await t.boards.onStart({ runId: 'r2', id: 'b' })
    await wait(60)
    assert.equal(t.posts.length, 2)
    assert.equal(t.posts[1].text, '🤖 1 subagent · 1 running\n⏳ Quick check · claude-opus-5-5 · <1m')
  } finally {
    t.boards.dispose()
  }
})

test('a running board is refreshed by its tick only when the shown time changes', async () => {
  const t = makeBoards({ tickMs: 40 })
  try {
    t.child('a', 'root', 'Research prices')
    await t.boards.onStart({ runId: 'r1', id: 'a' })
    await wait(30)
    assert.equal(t.posts.length, 1)
    await wait(110)
    assert.equal(t.edits.length, 0, 'same minute, no edit')
    t.advance(120_000)
    await wait(110)
    assert.equal(t.edits.length, 1)
    assert.match(t.edits[0].text, /· 2m$/u)
  } finally {
    t.boards.dispose()
  }
})

test('a deleted status message is replaced; a failed edit waits for the next change', async () => {
  let outcome = 'failed'
  const t = makeBoards({ edit: () => outcome })
  try {
    t.child('a', 'root', 'One')
    t.child('b', 'root', 'Two')
    await t.boards.onStart({ runId: 'r1', id: 'a' })
    await wait(60)
    await t.boards.onStart({ runId: 'r2', id: 'b' })
    await wait(60)
    assert.equal(t.posts.length, 1, 'a failed edit sends nothing new')
    outcome = 'gone'
    t.boards.onEnd({ runId: 'r1', id: 'a', stopReason: 'completed' })
    await wait(60)
    assert.equal(t.posts.length, 2, 'a message that is gone is sent again')
    assert.match(t.posts[1].text, /✓ One/u)
  } finally {
    t.boards.dispose()
  }
})

test('a label missing at start is read again before the next edit', async () => {
  const t = makeBoards()
  try {
    t.child('a', 'root')
    await t.boards.onStart({ runId: 'r1', id: 'a' })
    await wait(60)
    assert.match(t.posts[0].text, /⏳ subagent a · /u)
    t.labels.set('a', 'Named later')
    t.boards.onEnd({ runId: 'r1', id: 'a', stopReason: 'completed' })
    await wait(60)
    assert.match(t.edits.at(-1).text, /✓ Named later · /u)
  } finally {
    t.boards.dispose()
  }
})
