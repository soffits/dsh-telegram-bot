/**
 * Telegram's side of the model picker: short callback keys for catalog
 * entries and phone-sized pages. Reading and switching a session's model and
 * the catalog itself are @soffits/dsh-plugin-sdk/channel's.
 */
import { createHash } from 'node:crypto'

/** Rows of providers or models shown per picker page, sized for a phone. */
export const MODEL_PAGE_SIZE = 8

/**
 * Short stable key for a provider or a provider/model pair, for callback data
 * (Telegram allows 64 bytes, and provider/model ids can be longer).
 * @param provider - provider id.
 * @param model - model id, or undefined for the provider itself.
 * @returns 12 hex characters.
 */
export function catalogKey(provider, model) {
  return createHash('sha256').update(`${provider}\n${model ?? ''}`).digest('hex').slice(0, 12)
}

/**
 * Resolve a provider callback key.
 * @param catalog - loaded catalog.
 * @param key - `catalogKey(provider)`.
 * @returns the provider group, or undefined.
 */
export function providerByKey(catalog, key) {
  return catalog?.groups.find((group) => catalogKey(group.id) === key)
}

/**
 * Resolve a model callback key.
 * @param catalog - loaded catalog.
 * @param key - `catalogKey(provider, model)`.
 * @returns `{ group, model }`, or undefined.
 */
export function modelByKey(catalog, key) {
  for (const group of catalog?.groups ?? []) {
    const model = group.models.find((entry) => catalogKey(group.id, entry.id) === key)
    if (model !== undefined) return { group, model }
  }
  return undefined
}

/**
 * Cut one page out of a list.
 * @param items - all entries.
 * @param page - requested page, clamped to the valid range.
 * @returns the page's items, its index and the page count.
 */
export function pageOf(items, page) {
  const pages = Math.max(1, Math.ceil(items.length / MODEL_PAGE_SIZE))
  const index = Math.min(Math.max(0, Number.isSafeInteger(page) ? page : 0), pages - 1)
  return { items: items.slice(index * MODEL_PAGE_SIZE, (index + 1) * MODEL_PAGE_SIZE), page: index, pages }
}
