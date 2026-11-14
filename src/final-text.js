/**
 * The text a finished turn leaves in its topic.
 *
 * Text written between tool calls ("Now the board entries.") streams into the
 * live reply like everything else, but it is working narration, not part of
 * the answer. So the final reply keeps, from each assistant message of the
 * turn, only an answer: the last text block of a message that called no tool.
 * A message that called a tool is mid-chain, so its text goes. The last block,
 * not all of them: Claude Code through dsh-oh-my-claude puts every text block
 * of its own tool loop into one message, with its tools recorded beside it.
 * Answers of several tool-free messages in one turn (a steer answered after a
 * first answer) are all kept, in order.
 */

/**
 * The answer one assistant message holds, or '' when it holds none.
 * @param message - an assistant message (`{ content: [...] }`).
 * @returns the last text block when the message called no tool.
 */
export function messageAnswer(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  if (content.some((block) => block?.type === 'tool-call')) return ''
  const texts = content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text.trim())
    .filter((text) => text.length > 0)
  return texts.at(-1) ?? ''
}

/**
 * The answer of one turn, read from the session's durable events.
 * @param events - session events (`{ type, data }`).
 * @param turn - DSH turn number.
 * @returns the answers of the turn's messages joined by blank lines, or '' when none.
 */
export function turnAnswer(events, turn) {
  if (!Array.isArray(events) || turn === undefined) return ''
  const answers = []
  for (const event of events) {
    if (event?.type !== 'assistant/message' || event.data?.turn !== turn) continue
    const answer = messageAnswer(event.data?.message ?? event.data)
    if (answer.length > 0) answers.push(answer)
  }
  return answers.join('\n\n')
}
