# Changelog

## 0.12.2

- Telegram's flood control no longer drops files and messages. When Telegram answers 429, the bot waits as long as it asks (up to 15 minutes for a new message or file, 3 for edits) instead of giving up when `retry_after` is over 60 s or after three tries, and every other call to that chat waits for the flood control to end instead of hitting it again; "typing…" is skipped meanwhile. Before, a presented file could vanish without a trace, since the "Could not send" note went through the same limited path.
- The live tool-call line is cut by the characters it shows, not its HTML, so its `<code>` tags stay whole and Telegram no longer rejects it with "can't find end tag".

## 0.12.1

- The one-time title migrations are gone: the bot no longer rewrites every bound session's title when it connects, no longer retitles sessions named after the sender line or context blocks of versions before 0.6.2, and no longer reads the `TG · <topic>` and `<topic> · <task>` title forms of earlier versions. Every bound session had already been moved to `Telegram-<person>-<task>`; a changed person label now reaches a title the next time its session is used.

## 0.12.0

- A send's copy in the bound session no longer starts with a `[Sent to the Telegram topic … by …]` line: its text is what was sent, and the sender and topic are metadata (`principal`, with the topic as `principal.chat`; a send that names no sender gets an `external` principal). The model reads them through dsh-message-context 0.3 or later.
- `dsh-telegram-send` and the `telegramTopics` service send audio, voice messages (`--voice` / `asVoice`), video and GIFs with Telegram's own players instead of as documents, take `--format html|plain` (`format`) besides the default Markdown, and send silently with `--silent` (`silent`).
