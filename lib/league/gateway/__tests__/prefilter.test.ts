import { describe, expect, it } from 'vitest'
import { prefilterRejects } from '../prefilter'

describe('gateway layer-0 prefilter', () => {
  it('accepts a short Hangul or Latin proposition', () => {
    expect(prefilterRejects('애플 내일 오를까?')).toBe(false)
    expect(prefilterRejects('Will AAPL rise')).toBe(false)
  })

  it('rejects length, emoji-only, control, url-only, and repeated junk', () => {
    expect(prefilterRejects('오?')).toBe(true)
    expect(prefilterRejects('🚀🚀🚀🚀🚀')).toBe(true)
    expect(prefilterRejects('https://evil.example/aaaa')).toBe(true)
    expect(prefilterRejects('aaaaaaaaaa')).toBe(true)
    expect(prefilterRejects(`x${'\u0001'}yyy`)).toBe(true)
    expect(prefilterRejects('x'.repeat(300))).toBe(true)
  })
})
