import './setup-home.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { effortChoices, pageOf, pickedSelection, sessionModelOf } from '../src/models.js'

test('a session that is not running reports its recorded model and releases the observation', async () => {
  let disposed = 0
  const ctx = {
    get: (name) => (name === 'sessionQuery'
      ? {
          observeSession: async () => ({
            projections: { values: { modelSelection: { lastUsed: { provider: 'aocro-antigravity', model: 'gemini-4-argon-high' }, next: { provider: 'anthropic', model: 'claude-opus-5-5', reasoningEffort: 'medium' } } } },
            [Symbol.dispose]() { disposed += 1 },
          }),
        }
      : name === 'agents' ? { get: () => undefined } : undefined),
  }
  assert.deepEqual(await sessionModelOf(ctx, 'session-cold'), { provider: 'anthropic', model: 'claude-opus-5-5', reasoningEffort: 'medium' }, 'the pending choice wins over the last request')
  assert.equal(disposed, 1)
  assert.equal(await sessionModelOf(ctx, undefined), undefined)
})

test('a live agent is asked directly', async () => {
  const ctx = { get: (name) => (name === 'agents' ? { get: () => ({ model: { current: () => ({ provider: 'p', model: 'm' }) } }) } : undefined) }
  assert.deepEqual(await sessionModelOf(ctx, 'session-live'), { provider: 'p', model: 'm' })
})

test('effort choices and model picks follow the Web picker', () => {
  const model = { id: 'x', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }
  assert.deepEqual(effortChoices(model, 'Default'), [{ id: undefined, name: 'Default' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }])
  assert.deepEqual(effortChoices({ id: 'y' }, 'Default'), [])
  const withDefault = { id: 'z', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } }
  assert.deepEqual(pickedSelection({ provider: 'a', model: 'z', reasoningEffort: 'max' }, 'a', withDefault), { provider: 'a', model: 'z', reasoningEffort: 'max' }, 'the same model keeps its effort')
  assert.deepEqual(pickedSelection({ provider: 'a', model: 'other', reasoningEffort: 'max' }, 'a', withDefault), { provider: 'a', model: 'z', reasoningEffort: 'low' }, 'another model starts at its default')
  assert.deepEqual(pickedSelection(undefined, 'a', model), { provider: 'a', model: 'x' })
})

test('pages are clamped', () => {
  const items = Array.from({ length: 17 }, (_, index) => index)
  assert.deepEqual(pageOf(items, 2), { items: [16], page: 2, pages: 3 })
  assert.deepEqual(pageOf(items, 9).page, 2)
  assert.deepEqual(pageOf(items, Number.NaN).page, 0)
  assert.deepEqual(pageOf([], 0), { items: [], page: 0, pages: 1 })
})

test('a session on a route this host no longer has moves to the default model', async () => {
  const { healGoneRoute } = await import('../src/models.js')
  const gone = Object.assign(new Error('no adapter registered for provider "anthropic"'), { code: 'NO_ADAPTER' })
  const selected = []
  const agentOn = (route) => ({ model: { current: () => route, select: (s) => selected.push(s) } })
  const ctxWith = (resolve) => ({
    get: (name) => (name === 'llm' ? { resolveCallConfig: resolve }
      : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'claude-code', model: 'claude-opus-5-5', reasoningEffort: 'high' }) }
        : undefined),
  })
  const moved = await healGoneRoute(ctxWith(async () => { throw gone }), agentOn({ provider: 'anthropic', model: 'claude-opus-5-5', reasoningEffort: 'medium' }))
  assert.deepEqual(moved, { from: { provider: 'anthropic', model: 'claude-opus-5-5', reasoningEffort: 'medium' }, to: { provider: 'claude-code', model: 'claude-opus-5-5', reasoningEffort: 'high' } })
  assert.deepEqual(selected, [{ provider: 'claude-code', model: 'claude-opus-5-5', reasoningEffort: 'high' }])
  selected.length = 0
  assert.equal(await healGoneRoute(ctxWith(async (c) => c), agentOn({ provider: 'claude-code', model: 'claude-sonnet-5-5' })), undefined, 'a working route stays')
  const down = Object.assign(new Error('timeout'), { code: 'TIMEOUT' })
  assert.equal(await healGoneRoute(ctxWith(async () => { throw down }), agentOn({ provider: 'openrouter', model: 'x' })), undefined, 'a route that is only failing now stays')
  assert.equal(await healGoneRoute(ctxWith(async () => { throw gone }), agentOn(undefined)), undefined)
  assert.deepEqual(selected, [])
})
