/**
 * Speech in Telegram messages: voice messages, audio files and round video
 * messages. Decoding and transcription are @soffits/dsh-channel-core's.
 */

/** Telegram message fields that carry speech, with a default file extension. */
const SPOKEN = [
  { field: 'voice', kind: 'voice message', extension: '.ogg' },
  { field: 'video_note', kind: 'video message', extension: '.mp4' },
  { field: 'audio', kind: 'audio file', extension: '.mp3' },
]

/**
 * The spoken media a message carries, if any.
 * @param message - Telegram message.
 * @returns `{ field, kind, file, name, seconds }`, or undefined.
 */
export function spokenMediaOf(message) {
  for (const entry of SPOKEN) {
    const file = message?.[entry.field]
    if (typeof file?.file_id !== 'string') continue
    const id = message.message_id ?? Date.now()
    const name = typeof file.file_name === 'string' && file.file_name.length > 0
      ? file.file_name
      : `telegram-${entry.field.replace('_', '-')}-${id}${entry.extension}`
    return { field: entry.field, kind: entry.kind, file, name, seconds: typeof file.duration === 'number' ? file.duration : undefined }
  }
  return undefined
}
