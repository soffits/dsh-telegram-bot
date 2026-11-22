# Changelog

## 0.15.0

- A goal started outside Telegram now gets the same goal panel as one started in the topic, posted when its first round is mirrored and edited in place as the goal changes. The round's driver prompt is no longer posted. From upstream 0.4.1, ported onto the fork's mirror.

## 0.14.2

- Session handling (resolving, creating and claiming a topic's session, unarchiving, steering prompts, recording notes, reading answers, titles and workspaces), the outbox spool, the subagent status card and `/agents` now come from `@soffits/dsh-channel-core`, shared with the Matrix bot, instead of a copy.
- A steered message the session already holds is never handed to DSH again, also when it is plain text.
- The outbox no longer keeps polling when the bot stops while it is starting.

## 0.14.1

- The answer, silent marker, model, voice and sender logic now comes from `@soffits/dsh-channel-core`, the package shared with the Matrix bot, instead of a copy in each bot.

## 0.14.0

- Merged upstream 0.4.0. A round of a goal created outside Telegram is shown in the topic as `🎯 Goal · N` when `mirrorTurns` is on, with its answer; rounds of goals started from the topic keep their own panel. From upstream, ported onto the fork's mirror.

## 0.13.0

- Action buttons: a topic send (`dsh-telegram-send --action <id>=<label> --action-event <channel>`, or `actions` on the `telegramTopics` service) puts inline buttons under its text, and the first press by an allowed person (only the `--action-user` ids when given, before `--action-expires`) is emitted for dsh-cron-jobs as that event with the sender's data, the button and who pressed as a `telegram-user` principal; the buttons then show the outcome. Buttons are kept in `$DSH_HOME/telegram/actions.json`, so a press works after a restart. Built beside the tool-approval buttons, which stay in memory because they belong to one running turn.

## 0.12.6

- A live answer is no longer held up by reasoning and tool-call edits: while an answer edit is queued or in flight those edits are skipped, and a burst of tool calls becomes one edit. After a Telegram 429 the topic's send rate recovers on its own after a few good calls, instead of staying at the slow spacing. The status file records the last rate limit. From upstream.

## 0.12.5

- Picking a model or effort in a topic switches only that topic's session. It used to go through the Web UI's model picker, which also saves every pick as the default for new sessions, so a switch in one chat changed the model every other new session started on. The model is still checked with the host before the switch, and `/new` in the topic still starts on the topic's pick.

## 0.12.4

- A session's title in a topic message, a forked session or a session list is read from the session each time, not from the copy the bot stored when it bound the topic, so a renamed session shows its new name.

## 0.12.3

- Prompts that another agent session sends a bound session (`open_session`, `prompt_session`) are no longer mirrored into its topic: they are briefs written for a model, and they landed in people's chats as "From agent session …". Prompts a person typed in the Web UI and scheduled-task prompts are still shown. Set `mirrorAgentPrompts` to bring the agent prompts back.

## 0.12.2

- Telegram's flood control no longer drops files and messages. When Telegram answers 429, the bot waits as long as it asks (up to 15 minutes for a new message or file, 3 for edits) instead of giving up when `retry_after` is over 60 s or after three tries, and every other call to that chat waits for the flood control to end instead of hitting it again; "typing…" is skipped meanwhile. Before, a presented file could vanish without a trace, since the "Could not send" note went through the same limited path.
- The live tool-call line is cut by the characters it shows, not its HTML, so its `<code>` tags stay whole and Telegram no longer rejects it with "can't find end tag".

## 0.12.1

- The one-time title migrations are gone: the bot no longer rewrites every bound session's title when it connects, no longer retitles sessions named after the sender line or context blocks of versions before 0.6.2, and no longer reads the `TG · <topic>` and `<topic> · <task>` title forms of earlier versions. Every bound session had already been moved to `Telegram-<person>-<task>`; a changed person label now reaches a title the next time its session is used.

## 0.12.0

- A send's copy in the bound session no longer starts with a `[Sent to the Telegram topic … by …]` line: its text is what was sent, and the sender and topic are metadata (`principal`, with the topic as `principal.chat`; a send that names no sender gets an `external` principal). The model reads them through dsh-message-context 0.3 or later.
- `dsh-telegram-send` and the `telegramTopics` service send audio, voice messages (`--voice` / `asVoice`), video and GIFs with Telegram's own players instead of as documents, take `--format html|plain` (`format`) besides the default Markdown, and send silently with `--silent` (`silent`).
