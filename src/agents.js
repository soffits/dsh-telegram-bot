/**
 * Subagent activity in Telegram topics.
 *
 * Each topic has at most one status card listing the subagents its session
 * started (description, model, elapsed time), across turns: a subagent
 * started while the card still shows running ones joins it. The card is
 * edited in place as they start and finish; changes that land close together
 * share one edit, and a running card is refreshed once a minute so its times
 * move. While anything runs the card stays the last message of the topic:
 * Telegram cannot pin a message to the bottom, so when any message lands
 * below it the card is sent again, silently, and the old copy deleted (the
 * usual "sticky message" approach of chat bots). Once every subagent on it is
 * done the card is left where it is as the final state; the next subagent
 * opens a new one. Subagents started by subagents are listed under their
 * parent, in the topic of the session at the top of the chain.
 *
 * `/agents` lists a session's subagents from DSH's durable catalogs, so it
 * also works after a restart.
 */
import { messageAnswer } from '@soffits/dsh-channel-core'

/** Pause that lets several starts or ends share one edit. */
export const EDIT_DELAY_MS = 1500
/** How often a board with running subagents is refreshed for its times. */
export const TICK_MS = 60_000
/** Parent links followed from a subagent up to a bound session. */
const MAX_DEPTH = 8
/** Subagents `/agents` lists at most, running ones first. */
export const LIST_LIMIT = 8
/** Lines a status message shows at most; older finished lines are folded. */
const MAX_LINES = 25
/** Longest description shown on a line. */
const LABEL_MAX = 60
/** Longest report preview `/agents` shows per subagent. */
export const REPORT_MAX = 240

/** @returns the text cut to `max` characters with an ellipsis. */
export function clip(text, max) {
  const value = String(text ?? '')
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/**
 * Format a duration. Running times are shown in whole minutes, so a board
 * refreshed once a minute stays accurate; finished times also show seconds.
 * @param ms - duration in milliseconds.
 * @param precise - include seconds.
 */
export function formatElapsed(ms, precise) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (!precise) return minutes < 1 ? '<1m' : `${minutes}m`
  if (minutes < 1) return `${seconds}s`
  return `${minutes}m ${seconds % 60}s`
}

/** @returns true when a finished run did not complete normally. */
function failed(stopReason) {
  return stopReason !== undefined && stopReason !== 'completed'
}

/** @returns the reason text for a failed run (`max_tokens` → `max tokens`). */
function reasonText(stopReason) {
  return String(stopReason).replace(/[_-]+/gu, ' ')
}

/**
 * The status text of one board.
 * @param entries - `{ label, model, depth, startedAt, endedAt, stopReason }` in start order.
 * @param now - current time in ms.
 * @param tr - `(en, ru) => text` for the bot language.
 */
export function boardText(entries, now, tr = (en) => en) {
  const running = entries.filter((entry) => entry.endedAt === undefined).length
  const failures = entries.filter((entry) => entry.endedAt !== undefined && failed(entry.stopReason)).length
  const total = entries.length
  const noun = tr(total === 1 ? 'subagent' : 'subagents', 'субагент(ов)')
  let head
  if (running > 0) head = `🤖 ${total} ${noun} · ${running} ${tr('running', 'работают')}`
  else if (failures > 0) head = `🤖 ${total} ${noun} · ${tr('done', 'готово')}, ${failures} ${tr('failed', 'с ошибкой')}`
  else head = `🤖 ${total} ${noun} · ${tr('all done', 'все готовы')}`
  const lines = entries.map((entry) => {
    const indent = entry.depth > 1 ? `${'  '.repeat(entry.depth - 2)}↳ ` : ''
    const parts = [clip(entry.label, LABEL_MAX)]
    if (entry.model) parts.push(entry.model)
    if (entry.endedAt === undefined) {
      parts.push(formatElapsed(now - entry.startedAt, false))
      return `${indent}⏳ ${parts.join(' · ')}`
    }
    parts.push(formatElapsed(entry.endedAt - entry.startedAt, true))
    if (failed(entry.stopReason)) parts.push(reasonText(entry.stopReason))
    return `${indent}${failed(entry.stopReason) ? '✗' : '✓'} ${parts.join(' · ')}`
  })
  if (lines.length > MAX_LINES) {
    // Keep running lines and the newest ones; fold the oldest finished lines.
    const keep = new Set()
    entries.forEach((entry, index) => { if (entry.endedAt === undefined) keep.add(index) })
    for (let index = entries.length - 1; index >= 0 && keep.size < MAX_LINES - 1; index -= 1) keep.add(index)
    const folded = lines.length - keep.size
    const shown = lines.filter((_line, index) => keep.has(index))
    return [head, `… ${folded} ${tr('earlier finished', 'завершённых ранее')}`, ...shown].join('\n')
  }
  return [head, ...lines].join('\n')
}

/** @returns whether a tool name is the subagent reporting tool (`send_message`, maybe prefixed). */
function isReportTool(name) {
  return typeof name === 'string' && (name === 'send_message' || name.endsWith('__send_message'))
}

/** @returns the `message` argument of a tool call, or ''. */
function reportArgument(block) {
  let args = block?.arguments ?? block?.input
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      return ''
    }
  }
  return typeof args?.message === 'string' ? args.message.trim() : ''
}

/**
 * The latest report a subagent left: a message it sent its parent, or the
 * answer of its last tool-free message, whichever is newer.
 * @param events - the child's session events (`{ type, data }`).
 * @returns the report text, or ''.
 */
export function reportOf(events) {
  if (!Array.isArray(events)) return ''
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const message = event.data?.message ?? event.data
    const content = Array.isArray(message?.content) ? message.content : []
    for (let block = content.length - 1; block >= 0; block -= 1) {
      const item = content[block]
      if (item?.type === 'tool-call' && isReportTool(item.name)) {
        const text = reportArgument(item)
        if (text.length > 0) return text
      }
    }
    const answer = messageAnswer(message)
    if (answer.length > 0) return answer
  }
  return ''
}

/**
 * State of one listed subagent, from its live agent and durable timing.
 * @param facts - `{ status, timing }`: live agent status (or undefined when not loaded) and the `subagentTiming` view.
 * @param now - current time in ms.
 * @returns `{ state, elapsedMs }`; state is running, done, failed, interrupted or idle.
 */
export function childState({ status, timing }, now) {
  const settled = Number.isFinite(timing?.settledMs) ? timing.settledMs : 0
  const active = timing?.active
  if (status === 'running') {
    return { state: 'running', elapsedMs: active === undefined ? settled : settled + Math.max(0, now - active.since) }
  }
  if (active !== undefined) {
    // A turn left open with no live agent was cut off, usually by a restart.
    return { state: status === undefined ? 'interrupted' : 'running', elapsedMs: settled + Math.max(0, (status === undefined ? active.through : now) - active.since) }
  }
  if (timing?.lastTurnCompleted === false) return { state: 'failed', elapsedMs: settled }
  if (timing?.lastTurnCompleted === true) return { state: 'done', elapsedMs: settled }
  return { state: 'idle', elapsedMs: settled }
}

/** @returns relative age such as `5m ago`. */
export function ageText(createdAt, now, tr = (en) => en) {
  if (!Number.isFinite(createdAt)) return ''
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000))
  if (minutes < 1) return tr('just now', 'только что')
  if (minutes < 60) return tr(`${minutes}m ago`, `${minutes} мин назад`)
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return tr(`${hours}h ago`, `${hours} ч назад`)
  return tr(`${Math.floor(hours / 24)}d ago`, `${Math.floor(hours / 24)} дн назад`)
}

const STATE_ICONS = { running: '⏳', done: '✓', failed: '✗', interrupted: '⚠️', idle: '•' }

/**
 * The `/agents` reply.
 * @param rows - `{ label, model, depth, state, elapsedMs, createdAt, report }`, newest first.
 * @param total - how many subagents the session has in all.
 * @param now - current time in ms.
 * @param tr - `(en, ru) => text`.
 */
export function agentsListText(rows, total, now, tr = (en) => en) {
  if (rows.length === 0) return tr('This session has started no subagents.', 'Эта сессия не запускала субагентов.')
  const head = total > rows.length
    ? tr(`🤖 Subagents (latest ${rows.length} of ${total}):`, `🤖 Субагенты (последние ${rows.length} из ${total}):`)
    : tr('🤖 Subagents:', '🤖 Субагенты:')
  const states = {
    running: tr('running', 'работает'),
    done: tr('done', 'готово'),
    failed: tr('failed', 'ошибка'),
    interrupted: tr('interrupted', 'прерван'),
    idle: tr('idle', 'ожидает'),
  }
  const blocks = rows.map((row) => {
    const indent = row.depth > 1 ? '↳ ' : ''
    const facts = [states[row.state] ?? row.state]
    if (row.model) facts.push(row.model)
    if (row.elapsedMs > 0 || row.state === 'running') facts.push(formatElapsed(row.elapsedMs, row.state !== 'running'))
    const age = ageText(row.createdAt, now, tr)
    if (age) facts.push(age)
    const lines = [`${indent}${STATE_ICONS[row.state] ?? '•'} ${clip(row.label, LABEL_MAX)}`, `   ${facts.join(' · ')}`]
    const report = clip(String(row.report ?? '').replace(/\s+/gu, ' ').trim(), REPORT_MAX)
    if (report) lines.push(`   “${report}”`)
    return lines.join('\n')
  })
  return [head, '', blocks.join('\n\n')].join('\n')
}

/**
 * Track subagent runs and keep one status card per topic, at its bottom.
 * @param deps - Host and Telegram access:
 *   - `parentOf(sessionId)`: the parent session id of a live session, or undefined.
 *   - `topicOf(sessionId)`: the topic state (`{ key }`) a session is bound to, or undefined.
 *   - `showsTurn(topic)`: whether the topic is showing a turn now; a new card opens only then.
 *   - `labelOf(parentId, childId)`: the child's description from its parent's catalog.
 *   - `modelOf(childId)`: the child's model id.
 *   - `post(topic, text)`: send a message silently, resolves to its id or undefined.
 *   - `edit(topic, messageId, text)`: resolves to `ok`, `gone` (send a new one) or `failed` (try later).
 *   - `remove(topic, messageId)`: delete a message.
 *   - `reportError(scope, error)`, `tr(en, ru)`, `now()`, `delayMs`, `tickMs`.
 * @returns `{ onStart, onEnd, noteMessage, dispose, boards }`; `noteMessage(topicKey, messageId)`
 *   is called for every message that lands in a topic, so the card can follow it down.
 */
export function createAgentBoards(deps) {
  const {
    parentOf, topicOf, showsTurn, labelOf, modelOf, post, edit, remove, reportError,
    tr = (en) => en, now = Date.now, delayMs = EDIT_DELAY_MS, tickMs = TICK_MS,
  } = deps
  /** The open card of each topic, by topic key. */
  const open = new Map()
  let disposed = false

  function closeBoard(board) {
    if (open.get(board.topic.key) === board) open.delete(board.topic.key)
    if (board.tick !== undefined) clearInterval(board.tick)
    board.tick = undefined
  }

  /** Publish soon; changes before the timer fires share the edit. */
  function schedule(board) {
    if (disposed || board.timer !== undefined) return
    board.timer = setTimeout(() => {
      board.timer = undefined
      board.chain = board.chain
        .then(() => publish(board))
        .catch((error) => reportError('subagent status', error))
    }, delayMs)
    board.timer.unref?.()
  }

  async function fillLabels(board) {
    await Promise.all([...board.entries.values()].filter((entry) => !entry.labelKnown).map(async (entry) => {
      const label = await Promise.resolve(labelOf(entry.parentId, entry.id)).catch(() => undefined)
      if (typeof label === 'string' && label.trim()) {
        entry.label = label.trim()
        entry.labelKnown = true
      }
    }))
  }

  /** Entries in start order, each nested subagent right under its parent. */
  function displayOrder(board) {
    const entries = [...board.entries.values()]
    const ids = new Set(entries.map((entry) => entry.id))
    const children = new Map()
    for (const entry of entries) {
      const parent = ids.has(entry.parentId) ? entry.parentId : undefined
      if (!children.has(parent)) children.set(parent, [])
      children.get(parent).push(entry)
    }
    const ordered = []
    const seen = new Set()
    const walk = (parent) => {
      for (const entry of children.get(parent) ?? []) {
        if (seen.has(entry)) continue
        seen.add(entry)
        ordered.push(entry)
        walk(entry.id)
      }
    }
    walk(undefined)
    // A cycle cannot come from DSH's parent links; keep any entry it would hide.
    for (const entry of entries) if (!seen.has(entry)) ordered.push(entry)
    return ordered
  }

  /** Whether a message landed in the topic after the card. */
  function buried(board) {
    return board.messageId !== undefined && board.latestSeen > board.messageId
  }

  async function publish(board) {
    if (disposed) return
    await fillLabels(board)
    const entries = displayOrder(board)
    const done = entries.every((entry) => entry.endedAt !== undefined)
    // Freeze before any wait, so a subagent starting meanwhile opens a new card.
    if (done) closeBoard(board)
    const text = boardText(entries, now(), tr)
    // A finished card stays where it is as the final state.
    if (!done && buried(board)) {
      await repost(board, text)
      return
    }
    if (text === board.lastText) return
    if (board.messageId !== undefined) {
      const outcome = await edit(board.topic, board.messageId, text)
      if (outcome === 'ok') {
        board.lastText = text
        return
      }
      if (outcome !== 'gone') {
        // A running card retries with its next change or tick; a finished
        // one has neither, so it tries once more after a pause.
        if (done) {
          await new Promise((resolve) => { setTimeout(resolve, delayMs * 4).unref?.() })
          if (!disposed && (await edit(board.topic, board.messageId, text)) === 'ok') board.lastText = text
        }
        return
      }
      board.messageId = undefined
    }
    await repost(board, text)
  }

  /** Send the card as the newest message, then delete the copy above. */
  async function repost(board, text) {
    const previous = board.messageId
    const messageId = await post(board.topic, text)
    if (messageId === undefined) return
    board.messageId = messageId
    board.lastText = text
    board.latestSeen = Math.max(board.latestSeen, messageId)
    if (previous !== undefined) await Promise.resolve(remove(board.topic, previous)).catch(() => {})
    // Something landed while the card was being sent: follow it down.
    if (buried(board) && open.get(board.topic.key) === board) schedule(board)
  }

  /**
   * A subagent run started (`subagent/start`).
   * @param info - `{ runId, id }`.
   */
  async function onStart(info) {
    if (disposed || typeof info?.id !== 'string') return
    const parentId = parentOf(info.id)
    let topic
    let depth = 1
    let current = parentId
    for (let hop = 0; hop < MAX_DEPTH && typeof current === 'string'; hop += 1) {
      topic = topicOf(current)
      if (topic !== undefined) break
      depth += 1
      current = parentOf(current)
    }
    if (topic === undefined) return
    let board = open.get(topic.key)
    if (board === undefined) {
      // A nested subagent belongs to a chain the topic already shows; a
      // top-level one opens a card only while the topic shows a turn.
      if (depth === 1 && !showsTurn(topic)) return
      board = { topic, entries: new Map(), messageId: undefined, lastText: undefined, latestSeen: 0, timer: undefined, tick: undefined, chain: Promise.resolve() }
      open.set(topic.key, board)
      board.tick = setInterval(() => schedule(board), tickMs)
      board.tick.unref?.()
    }
    const entry = {
      id: info.id,
      parentId,
      label: tr(`subagent ${info.id.slice(0, 8)}`, `субагент ${info.id.slice(0, 8)}`),
      labelKnown: false,
      model: '',
      depth,
      startedAt: now(),
      endedAt: undefined,
      stopReason: undefined,
    }
    board.entries.set(info.runId ?? info.id, entry)
    schedule(board)
    const model = await Promise.resolve(modelOf(info.id)).catch(() => undefined)
    if (typeof model === 'string' && model.length > 0) entry.model = model
  }

  /**
   * A subagent run ended (`subagent/end`).
   * @param info - `{ runId, id, stopReason }`.
   */
  function onEnd(info) {
    const key = info?.runId ?? info?.id
    for (const board of open.values()) {
      const entry = board.entries.get(key)
      if (entry === undefined || entry.endedAt !== undefined) continue
      entry.endedAt = now()
      entry.stopReason = info.stopReason
      schedule(board)
      return
    }
  }

  /**
   * A message landed in a topic (sent by anyone, the bot included).
   * @param topicKey - the topic's key.
   * @param messageId - the Telegram message id; ids grow within a chat.
   */
  function noteMessage(topicKey, messageId) {
    const board = open.get(topicKey)
    if (board === undefined || !Number.isSafeInteger(messageId)) return
    board.latestSeen = Math.max(board.latestSeen, messageId)
    if (buried(board)) schedule(board)
  }

  function dispose() {
    disposed = true
    for (const board of open.values()) {
      if (board.timer !== undefined) clearTimeout(board.timer)
      if (board.tick !== undefined) clearInterval(board.tick)
    }
    open.clear()
  }

  return { onStart, onEnd, noteMessage, dispose, boards: open }
}

/**
 * Collect a session's subagents for `/agents`: every descendant reachable
 * through the catalogs of recent children, newest first, running ones kept.
 * @param listChildren - `(sessionId) => Promise<[{ id, label, createdAt, mode }]>`.
 * @param rootId - the topic's session.
 * @param isRunning - `(id) => boolean` for live, working subagents.
 * @param limit - rows to return.
 * @returns `{ rows: [{ id, label, createdAt, depth }], total }`.
 */
export async function collectSubagents(listChildren, rootId, isRunning, limit = LIST_LIMIT) {
  const found = []
  const seen = new Set([rootId])
  /** Catalog reads are bounded: descendants of old children are old too. */
  let budget = limit * 4
  const walk = async (parentId, depth) => {
    let children
    try {
      children = await listChildren(parentId)
    } catch {
      return
    }
    if (!Array.isArray(children)) return
    const recent = [...children].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
    for (const child of recent) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      found.push({ id: child.id, label: child.label, createdAt: child.createdAt, depth })
    }
    for (const child of recent) {
      if (child.mode === 'external' || depth >= MAX_DEPTH) continue
      if (budget <= 0 && !isRunning(child.id)) continue
      budget -= 1
      await walk(child.id, depth + 1)
    }
  }
  await walk(rootId, 1)
  found.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
  const running = found.filter((row) => isRunning(row.id))
  const rows = [...running, ...found.filter((row) => !isRunning(row.id)).slice(0, Math.max(0, limit - running.length))]
  rows.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
  return { rows, total: found.length }
}
