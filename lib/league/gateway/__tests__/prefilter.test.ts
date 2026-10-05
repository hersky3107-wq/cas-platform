import { describe, expect, it } from 'vitest'
import { prefilterRejects } from '../prefilter'

describe('gateway layer-0 prefilter', () => {
  it('accepts a short Hangul, Latin, CJK, or Arabic proposition', () => {
    expect(prefilterRejects('애플 내일 오를까?')).toBe(false)
    expect(prefilterRejects('Will AAPL rise')).toBe(false)
    expect(prefilterRejects('サムスンは年末までに3つ折りを発売する？')).toBe(false)
    expect(prefilterRejects('三星會在年底前推出三摺手機嗎？')).toBe(false)
    expect(prefilterRejects('هل تعلن آبل عن آيباد جديد في أكتوبر؟')).toBe(false)
  })

  it('rejects length, emoji-only, control, url-only, and repeated junk', () => {
    expect(prefilterRejects('오?')).toBe(true)
    expect(prefilterRejects('토트넘')).toBe(false)
    expect(prefilterRejects('맨유')).toBe(false)
    expect(prefilterRejects('🚀🚀🚀🚀🚀')).toBe(true)
    expect(prefilterRejects('https://evil.example/aaaa')).toBe(true)
    expect(prefilterRejects('aaaaaaaaaa')).toBe(true)
    expect(prefilterRejects(`x${'\u0001'}yyy`)).toBe(true)
    expect(prefilterRejects('x'.repeat(300))).toBe(true)
  })
})
