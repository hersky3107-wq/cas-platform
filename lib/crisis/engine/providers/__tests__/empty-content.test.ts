import { describe, expect, it } from 'vitest'
import { chatContent, parseHttpBody, requireText } from '../http'
import { EmptyContentError } from '../types'

describe('empty content', () => {
  it('surfaces finish_reason=length instead of a silent null', () => {
    const parsed = chatContent({
      choices: [{ message: { content: '' }, finish_reason: 'length' }],
      usage: { completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 20 } },
    })
    expect(parsed.text).toBe('')
    expect(parsed.finishReason).toBe('length')
    expect(() => requireText('z-ai/glm-5.3', parsed.text, parsed.finishReason)).toThrow(EmptyContentError)
    expect(() => requireText('z-ai/glm-5.3', parsed.text, parsed.finishReason)).toThrow(/finish_reason=length/)
  })

  it('parses SSE JSON and rejects HTML error pages', () => {
    const sse = parseHttpBody('data: {"ok":true}\n\ndata: [DONE]\n', 'text/event-stream')
    expect(sse).toEqual({ ok: true })
    expect(parseHttpBody('<html>error</html>', 'text/html')).toBeNull()
  })
})
