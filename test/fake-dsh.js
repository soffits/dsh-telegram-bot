/**
 * Shared pieces of the fake DSH Host used by the test files. This file has no
 * tests of its own.
 */

/**
 * Model how DSH starts a turn for a queued message: every follow-up opens a
 * turn (so the session is no longer blank), and `agent/pre-step` handlers may
 * reject it before any model request, in which case the message is never
 * recorded.
 * @param agent - fake agent with `received`; gets `turns` and `rejected`.
 * @param events - the agent's event emitter.
 * @param message - the queued user message.
 */
export function followupThroughGate(agent, events, message) {
  agent.turns = (agent.turns ?? 0) + 1
  agent.received.push(message)
  const handlers = events.listeners('agent/pre-step')
  const run = (index) => index < handlers.length
    ? Promise.resolve(handlers[index]({ agent, messages: [message] }, () => run(index + 1)))
    : Promise.resolve({ kind: 'enter' })
  void run(0).then((decision) => {
    if (decision?.kind !== 'reject') return
    agent.received.splice(agent.received.indexOf(message), 1)
    agent.rejected ??= []
    agent.rejected.push(message)
  })
}

/**
 * Fake `sessionTitle` service: the latest title lives on the session object
 * (`title`, `titleSource`, `titleSeqs`). Titles are written through
 * `session.append('session/title', ...)` when the fake session has one, so
 * listeners see the event as in DSH. `refresh` stands in for the title model.
 * @returns the service.
 */
export function makeTitleService() {
  const write = (session, data) => {
    if (typeof session.append === 'function' && Array.isArray(session.events)) session.append('session/title', data)
    else Object.assign(session, { title: data.title, titleSource: data.source, titleSeqs: data.messageSeqs })
  }
  const service = {
    refreshed: [],
    get: (session) => (typeof session.title === 'string'
      ? { title: session.title, source: session.titleSource ?? { kind: 'user' }, messageSeqs: session.titleSeqs ?? [] }
      : undefined),
    rename: (session, title) => {
      write(session, { title, messageSeqs: [], source: { kind: 'user' } })
      return service.get(session)
    },
    async refresh(session) {
      service.refreshed.push(session.id)
      write(session, { title: session.nextGeneratedTitle ?? 'Generated task', messageSeqs: [1], source: { kind: 'provider', provider: 'fake' } })
      return service.get(session)
    },
  }
  return service
}

/**
 * Fake `agent.model`, folding the session log the way DSH's modelSelection
 * projection does: a `model/selection` event is the pending choice, a
 * `request/header` is the last route used and retires a matching pending
 * choice; with neither, the agent's options apply.
 * @param session - fake session with `events` and `append`.
 * @param options - agent options (`provider`, `model`, `reasoningEffort`), may be getters.
 * @returns the model handle.
 */
export function makeAgentModel(session, options = {}) {
  const same = (left, right) => left !== null && right !== null
    && left.provider === right.provider && left.model === right.model && left.reasoningEffort === right.reasoningEffort
  const recorded = () => {
    let lastUsed = null
    let pending = null
    for (const event of session.events) {
      if (event.type === 'model/selection') pending = { ...event.data }
      if (event.type === 'request/header') {
        const { provider, model, reasoningEffort } = event.data.header.config
        lastUsed = { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }
        if (same(pending, lastUsed)) pending = null
      }
    }
    return pending ?? lastUsed
  }
  return {
    current() {
      const found = recorded()
      if (found !== null) return { ...found }
      const { provider, model, reasoningEffort } = options
      return provider && model ? { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) } : undefined
    },
    select(selection) {
      const next = { provider: selection.provider, model: selection.model, ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }) }
      if (same(recorded(), next)) return
      session.append('model/selection', next)
    },
  }
}
