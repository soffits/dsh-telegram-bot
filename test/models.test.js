import './setup-home.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { pageOf } from '../src/models.js'

test('pages are clamped', () => {
  const items = Array.from({ length: 17 }, (_, index) => index)
  assert.deepEqual(pageOf(items, 2), { items: [16], page: 2, pages: 3 })
  assert.deepEqual(pageOf(items, 9).page, 2)
  assert.deepEqual(pageOf(items, Number.NaN).page, 0)
  assert.deepEqual(pageOf([], 0), { items: [], page: 0, pages: 1 })
})
