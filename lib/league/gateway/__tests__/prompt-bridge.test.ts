import { afterEach, describe, expect, it } from 'vitest'
import { getLeagueUiPack } from '../../i18n/dictionary'
import {
  bridgePromptToEnglish,
  needsEnglishBridge,
  publishedEnglishGloss,
  setPromptBridgeCaller,
} from '../prompt-bridge'

afterEach(() => setPromptBridgeCaller(null))

describe('prompt bridge', () => {
  it('leaves Korean and English prompts alone', async () => {
    expect(needsEnglishBridge('ko', '서울 아파트 이번 달 오를까?')).toBe(false)
    expect(needsEnglishBridge('en', 'Will the Seoul apartment price index rise this month?')).toBe(false)
    const out = await bridgePromptToEnglish('서울 아파트 이번 달 오를까?', 'ko')
    expect(out.text).toBe('서울 아파트 이번 달 오를까?')
    expect(out.original).toBe(out.text)
  })

  it('glosses a published Japanese chip onto the English hub sentence', async () => {
    const ja = getLeagueUiPack('ja').catalog.freeformPanel.tech.examples[0]!
    const en = getLeagueUiPack('en').catalog.freeformPanel.tech.examples[0]!
    expect(publishedEnglishGloss(ja)).toBe(en)
    const bridged = await bridgePromptToEnglish(ja, 'ja')
    expect(bridged.text).toBe(en)
    expect(bridged.original).toBe(ja)
  })

  it('asks the cheap model only when the sentence is not a published chip', async () => {
    const seen: string[] = []
    setPromptBridgeCaller(async (text) => {
      seen.push(text)
      return 'Will the fictional studio ship a quantum laptop?'
    })
    const bridged = await bridgePromptToEnglish('虛構工作室下季會推出量子筆電嗎？', 'zh-TW')
    expect(seen).toEqual(['虛構工作室下季會推出量子筆電嗎？'])
    expect(bridged.text).toBe('Will the fictional studio ship a quantum laptop?')
    expect(bridged.original).toContain('量子')
  })

  it('does not translate an encoded instrument', () => {
    expect(needsEnglishBridge('ja', 'TECH:samsung:ship:2026-12-31')).toBe(false)
  })
})
