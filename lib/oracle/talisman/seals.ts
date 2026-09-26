/**
 * Seal targets: the subset of native findings the talisman covers rather than
 * draws. Whatever a seal covers is removed from every layer that crosses that
 * sector.
 *
 * Seals are genuine inauspicious findings only:
 *   구성 흉방 cells, 자미 살성 palaces, 자미 化忌 palace, 성명 대흉 seats.
 * A reversed tarot card or rune inverts a meaning; it is not 흉 and does not
 * get a lock. Reversals stay on their own layer as a rotated glyph.
 *
 * 중궁 (구성 본명살이 가운데에 앉은 경우) is not sealed — the core is the 용신.
 */

import { BRANCH_PALACE, LUOSHU_PALACES } from '../engines/calendar'
import type { CompassDirection } from '../engines/calendar'
import type { NativeFindings, SealTarget, TalismanSector } from './types'

function directionForBranch(branchIndex: number): CompassDirection {
  const palace = BRANCH_PALACE[branchIndex]!
  return LUOSHU_PALACES.find((cell) => cell.palace === palace)!.direction
}

function luoshuKey(direction: CompassDirection): string {
  return `luoshu:${direction}`
}

function sectorKey(sector: TalismanSector): string {
  if (sector.frame === 'luoshu') return luoshuKey(sector.direction)
  if (sector.frame === 'ziwei') return `ziwei:${sector.palace}`
  if (sector.frame === 'gyeok') return `gyeok:${sector.seat}`
  return `spread:${sector.system}:${sector.index}`
}

function luoshuOverlapKey(sector: TalismanSector): string | null {
  if (sector.frame === 'luoshu') return luoshuKey(sector.direction)
  if (sector.frame === 'ziwei') return luoshuKey(directionForBranch(sector.branchIndex))
  return null
}

export function collectSeals(findings: NativeFindings): SealTarget[] {
  const seals: SealTarget[] = []
  const takenLuoshu = new Set<string>()

  const push = (seal: SealTarget) => {
    const overlap = luoshuOverlapKey(seal.sector)
    if (overlap) {
      if (takenLuoshu.has(overlap)) return
      takenLuoshu.add(overlap)
    }
    seals.push(seal)
  }

  if (findings.ninestar) {
    for (const killing of findings.ninestar.killings) {
      if (killing.direction === 'center') continue
      push({
        id: `ninestar:${killing.name}:${killing.direction}`,
        kind: 'ninestar-killing',
        rule: killing.name,
        sector: { frame: 'luoshu', direction: killing.direction },
      })
    }
  }

  if (findings.ziwei) {
    for (const palace of findings.ziwei.maleficPalaces) {
      push({
        id: `ziwei-malefic:${palace.name}`,
        kind: 'ziwei-malefic',
        rule: `살성 ${palace.stars.join('·')}`,
        sector: { frame: 'ziwei', palace: palace.name, branchIndex: palace.branchIndex },
      })
    }
    const ji = findings.ziwei.huaJiPalace
    if (ji) {
      push({
        id: `ziwei-huaji:${ji.name}`,
        kind: 'ziwei-huaji',
        rule: `化忌 ${ji.star}`,
        sector: { frame: 'ziwei', palace: ji.name, branchIndex: ji.branchIndex },
      })
    }
  }

  if (findings.name) {
    for (const hit of findings.name.daehyung) {
      push({
        id: `name-daehyung:${hit.seat}`,
        kind: 'name-daehyung',
        rule: `대흉 ${hit.seat} ${hit.number}`,
        sector: { frame: 'gyeok', seat: hit.seat },
      })
    }
  }

  return seals
}

function sealedLuoshu(seals: SealTarget[]): Set<CompassDirection> {
  const dirs = new Set<CompassDirection>()
  for (const seal of seals) {
    if (seal.sector.frame === 'luoshu') dirs.add(seal.sector.direction)
    if (seal.sector.frame === 'ziwei') dirs.add(directionForBranch(seal.sector.branchIndex))
  }
  return dirs
}

function sealedKeys(seals: SealTarget[]): Set<string> {
  return new Set(seals.map((seal) => sectorKey(seal.sector)))
}

/**
 * Strip covered items from every layer that crosses a sealed sector.
 * Seals themselves stay; the layer no longer draws what the lock covers.
 * Tarot/rune reversals are never sealed, so they stay on the layer.
 */
export function subtractSealed(findings: NativeFindings, seals: SealTarget[]): NativeFindings {
  const keys = sealedKeys(seals)
  const luoshu = sealedLuoshu(seals)

  const ninestar = findings.ninestar
    ? {
        ...findings.ninestar,
        killings: findings.ninestar.killings.filter((killing) => {
          if (killing.direction === 'center') return true
          return !luoshu.has(killing.direction)
        }),
      }
    : null

  const ziwei = findings.ziwei
    ? {
        ...findings.ziwei,
        maleficPalaces: findings.ziwei.maleficPalaces.filter((palace) => {
          if (keys.has(`ziwei:${palace.name}`)) return false
          return !luoshu.has(directionForBranch(palace.branchIndex))
        }),
        huaJiPalace:
          findings.ziwei.huaJiPalace &&
          (keys.has(`ziwei:${findings.ziwei.huaJiPalace.name}`) ||
            luoshu.has(directionForBranch(findings.ziwei.huaJiPalace.branchIndex)))
            ? null
            : findings.ziwei.huaJiPalace,
        emptyPalaces: findings.ziwei.emptyPalaces.filter((palace) => {
          if (keys.has(`ziwei:${palace.name}`)) return false
          return !luoshu.has(directionForBranch(palace.branchIndex))
        }),
      }
    : null

  const name = findings.name
    ? {
        ...findings.name,
        daehyung: findings.name.daehyung.filter((hit) => !keys.has(`gyeok:${hit.seat}`)),
      }
    : null

  return { ...findings, ninestar, ziwei, name }
}
