/**
 * Purpose filters — five thin tables over fields that already exist.
 * Where a system has no basis, return none. Do not invent a mapping.
 *
 * 재물  자미 財帛 · 사주 재성 · PRISM money · 육효 妻财
 * 연애  자미 夫妻 · PRISM love · (사주 none — no exclusive 십신)
 * 승진  자미 官祿 · 사주 관성 · PRISM work · 육효 官鬼
 * 건강  자미 疾厄 · PRISM energy · (사주 none)
 * 파마  구성 흉방 · 자미 살성/化忌 · 성명 대흉 · 육효 子孙 vs 官鬼
 */

import type { SixRelative } from '../engines/draw/tables'
import type { DomainName } from '../engines/prism/tables'
import type { PalaceName as ZiweiPalaceName } from '../engines/ziwei/types'
import type {
  FudanSpec,
  NativeFindings,
  PurposeBundle,
  PurposeCell,
  PurposeTable,
  TalismanPurpose,
  TenGodGroupName,
} from './types'
import { FUDAN_GLYPH } from './types'

function none<T>(): PurposeCell<T> {
  return { status: 'none' }
}

function hit<T>(value: T): PurposeCell<T> {
  return { status: 'hit', value }
}

function fudanFor(purpose: TalismanPurpose): FudanSpec {
  return { kind: 'hanja', purpose, glyph: FUDAN_GLYPH[purpose] }
}

function ziweiPalace(
  findings: NativeFindings,
  palace: ZiweiPalaceName,
): PurposeTable['ziwei'] {
  if (!findings.ziwei || findings.ziwei.palacesUnavailable) return none()
  const base = findings.ziwei.palaces.find((p) => p.name === palace)
  if (!base) return none()
  const empty = findings.ziwei.emptyPalaces.some((p) => p.name === palace)
  const malefic = findings.ziwei.maleficPalaces.find((p) => p.name === palace)
  return hit({
    name: palace,
    index: base.index,
    branchIndex: base.branchIndex,
    malefics: malefic?.stars ?? [],
    empty,
    huaJi: findings.ziwei.huaJiPalace?.name === palace,
  })
}

function sajuGroup(findings: NativeFindings, group: TenGodGroupName): PurposeTable['saju'] {
  if (!findings.saju) return none()
  return hit({ group, count: findings.saju.groupCounts[group] })
}

function prismDomain(findings: NativeFindings, chartsScore: number | undefined, domain: DomainName): PurposeTable['prism'] {
  if (!findings.prism || chartsScore == null) return none()
  return hit({
    domain,
    isWarning: findings.prism.warningDomain === domain,
    score: chartsScore,
  })
}

function relativeState(
  hiddenRelatives: readonly SixRelative[],
  relative: SixRelative,
): { relative: SixRelative; state: 'present' | 'bokjang' } {
  return { relative, state: hiddenRelatives.includes(relative) ? 'bokjang' : 'present' }
}

function ichingRelative(findings: NativeFindings, relative: SixRelative): PurposeTable['iching'] {
  if (!findings.iching) return none()
  return hit([relativeState(findings.iching.hiddenRelatives, relative)])
}

function ichingExorcism(findings: NativeFindings): PurposeTable['iching'] {
  if (!findings.iching) return none()
  return hit([
    relativeState(findings.iching.hiddenRelatives, '子孙'),
    relativeState(findings.iching.hiddenRelatives, '官鬼'),
  ])
}

type PrismScores = Partial<Record<DomainName, number>> | null | undefined

function tableFor(
  purpose: TalismanPurpose,
  findings: NativeFindings,
  prismScores: PrismScores,
): PurposeTable {
  const fudan = fudanFor(purpose)
  switch (purpose) {
    case 'wealth':
      return {
        purpose,
        fudan,
        ziwei: ziweiPalace(findings, '財帛'),
        saju: sajuGroup(findings, '재성'),
        prism: prismDomain(findings, prismScores?.money, 'money'),
        iching: ichingRelative(findings, '妻财'),
        ninestar: none(),
        name: none(),
      }
    case 'love':
      return {
        purpose,
        fudan,
        ziwei: ziweiPalace(findings, '夫妻'),
        saju: none(),
        prism: prismDomain(findings, prismScores?.love, 'love'),
        iching: none(),
        ninestar: none(),
        name: none(),
      }
    case 'promotion':
      return {
        purpose,
        fudan,
        ziwei: ziweiPalace(findings, '官祿'),
        saju: sajuGroup(findings, '관성'),
        prism: prismDomain(findings, prismScores?.work, 'work'),
        iching: ichingRelative(findings, '官鬼'),
        ninestar: none(),
        name: none(),
      }
    case 'health':
      return {
        purpose,
        fudan,
        ziwei: ziweiPalace(findings, '疾厄'),
        saju: none(),
        prism: prismDomain(findings, prismScores?.energy, 'energy'),
        iching: none(),
        ninestar: none(),
        name: none(),
      }
    case 'exorcism':
      return {
        purpose,
        fudan,
        ziwei:
          findings.ziwei && !findings.ziwei.palacesUnavailable
            ? hit({
                name: findings.ziwei.huaJiPalace?.name ?? findings.ziwei.maleficPalaces[0]?.name ?? '命',
                index: findings.ziwei.huaJiPalace?.index ?? findings.ziwei.maleficPalaces[0]?.index ?? 0,
                branchIndex: findings.ziwei.huaJiPalace?.branchIndex ?? findings.ziwei.maleficPalaces[0]?.branchIndex ?? 0,
                malefics: findings.ziwei.maleficPalaces.flatMap((p) => p.stars),
                empty: false,
                huaJi: findings.ziwei.huaJiPalace != null,
              })
            : none(),
        saju: none(),
        prism: none(),
        iching: ichingExorcism(findings),
        ninestar: findings.ninestar ? hit(findings.ninestar.killings) : none(),
        name: findings.name?.supported ? hit(findings.name.daehyung) : none(),
      }
  }
}

export function purposeBundle(
  findings: NativeFindings,
  input: { active: TalismanPurpose | null; prismScores?: PrismScores },
): PurposeBundle {
  const purposes: TalismanPurpose[] = ['wealth', 'love', 'promotion', 'health', 'exorcism']
  const tables = {} as Record<TalismanPurpose, PurposeTable>
  for (const purpose of purposes) {
    tables[purpose] = tableFor(purpose, findings, input.prismScores)
  }
  return { active: input.active, tables }
}

export function fudanSpec(purpose: TalismanPurpose | null): FudanSpec {
  if (purpose) return fudanFor(purpose)
  return { kind: 'bindrune', purpose: null, glyph: 'BINDRUNE' }
}
