import './setup-home.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { spokenMediaOf } from '../src/voice.js'

test('spoken media is found in voice, round video and audio messages', () => {
  assert.equal(spokenMediaOf({ message_id: 5, voice: { file_id: 'v', duration: 7 } }).name, 'telegram-voice-5.ogg')
  assert.equal(spokenMediaOf({ message_id: 5, video_note: { file_id: 'n' } }).kind, 'video message')
  assert.equal(spokenMediaOf({ message_id: 5, audio: { file_id: 'a', file_name: 'memo.m4a' } }).name, 'memo.m4a')
  assert.equal(spokenMediaOf({ message_id: 5, text: 'hi' }), undefined)
})
