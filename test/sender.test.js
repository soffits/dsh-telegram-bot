import './setup-home.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { postPrincipal, telegramUserPrincipal } from '../src/sender.js'

test('a Telegram user principal names the user and the topic, without empty fields', () => {
  assert.deepEqual(
    telegramUserPrincipal({ id: 42, first_name: 'Ana', last_name: ' ', username: 'ana' }, { chatId: 100, threadId: 7001, topic: 'Notify' }),
    { kind: 'telegram-user', channel: 'telegram', id: '42', name: 'Ana', username: 'ana', chat: { id: '100', thread: 7001, name: 'Notify' } },
  )
  assert.deepEqual(telegramUserPrincipal({ id: 7 }, { chatId: 7 }), { kind: 'telegram-user', channel: 'telegram', id: '7', chat: { id: '7' } })
  assert.equal(telegramUserPrincipal(undefined), undefined)
  assert.equal(telegramUserPrincipal({ first_name: 'no id' }), undefined)
})

test('a post names its sender and the topic it went to, and a nameless send is still not a person', () => {
  assert.deepEqual(postPrincipal({ job: 'Digest' }, { id: '100', thread: 7, name: 'Notify' }),
    { kind: 'cron-job', channel: 'cron', id: 'Digest', name: 'Digest', chat: { channel: 'telegram', id: '100', thread: 7, name: 'Notify' } })
  assert.equal(postPrincipal(undefined, { id: '100', thread: 7 }).kind, 'external')
})
