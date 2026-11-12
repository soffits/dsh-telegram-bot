/** Durable Telegram state file. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { STATUS_DIR } from './constants.js'

/** Durable Telegram chat → DSH session mapping. */
const STATE_PATH = join(STATUS_DIR, 'state.json')

/**
 * Drop the model copies older versions kept on session records. The session
 * itself records its model; a copy here went stale and was read back as truth.
 * @param sessions - session records by id.
 * @returns the records without `provider`, `model` and `effort`.
 */
function withoutModelCopies(sessions) {
  return Object.fromEntries(Object.entries(sessions).map(([id, record]) => {
    if (record === null || typeof record !== 'object') return [id, record]
    const { provider: _provider, model: _model, effort: _effort, ...rest } = record
    return [id, rest]
  }))
}

/**
 * Read the chat/session mapping. A missing or malformed file starts empty.
 * @returns the mapping document.
 */
async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, 'utf8'))
    if (parsed !== null && typeof parsed === 'object') {
      return {
        version: 2,
        sessions: parsed.sessions !== null && typeof parsed.sessions === 'object' ? withoutModelCopies(parsed.sessions) : {},
        threads: parsed.threads !== null && typeof parsed.threads === 'object' ? parsed.threads : {},
        updateLedger: parsed.updateLedger !== null && typeof parsed.updateLedger === 'object' && !Array.isArray(parsed.updateLedger) ? parsed.updateLedger : {},
        updateOffset: Number.isSafeInteger(parsed.updateOffset) && parsed.updateOffset >= 0 ? parsed.updateOffset : 0,
        topicNames: parsed.topicNames !== null && typeof parsed.topicNames === 'object' && !Array.isArray(parsed.topicNames) ? parsed.topicNames : {},
        directChats: parsed.directChats !== null && typeof parsed.directChats === 'object' && !Array.isArray(parsed.directChats) ? parsed.directChats : {},
        directTopics: parsed.directTopics !== null && typeof parsed.directTopics === 'object' && !Array.isArray(parsed.directTopics) ? parsed.directTopics : {},
        goalPanels: parsed.goalPanels !== null && typeof parsed.goalPanels === 'object' && !Array.isArray(parsed.goalPanels) ? parsed.goalPanels : (parsed.goalPins !== null && typeof parsed.goalPins === 'object' && !Array.isArray(parsed.goalPins) ? parsed.goalPins : {}),
      }
    }
  } catch {
    // Missing or corrupt state is nonfatal; the next session creates a mapping.
  }
  return { version: 2, sessions: {}, threads: {}, updateLedger: {}, updateOffset: 0, topicNames: {}, directChats: {}, directTopics: {}, goalPanels: {} }
}

export { STATE_PATH, loadState }
