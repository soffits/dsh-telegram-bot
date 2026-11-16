# Changelog

## Unreleased

- A send's copy in the bound session no longer starts with a `[Sent to the Telegram topic … by …]` line: its text is what was sent, and the sender and topic are metadata (`principal`, with the topic as `principal.chat`; a send that names no sender gets an `external` principal). The model reads them through dsh-message-context 0.3 or later.
- `dsh-telegram-send` and the `telegramTopics` service send audio, voice messages (`--voice` / `asVoice`), video and GIFs with Telegram's own players instead of as documents, take `--format html|plain` (`format`) besides the default Markdown, and send silently with `--silent` (`silent`).
