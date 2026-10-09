import type { Department, Hypothesis } from './schema'

const KEY_DEPARTMENT: Record<string, Department> = {
  rain: 'natural-hydro',
  river: 'natural-hydro',
  cyclone: 'natural-hydro',
  cyclone_formation: 'natural-hydro',
  dam: 'natural-hydro',
  quake: 'natural-geo',
  volcano: 'natural-geo',
  fire: 'natural-geo',
  gdacs: 'natural-geo',
  landslide: 'natural-geo',
  health_attention: 'health',
  disease: 'health',
  conflict: 'conflict-political',
  silence: 'conflict-political',
  advisory: 'conflict-political',
  internet: 'conflict-political',
  escalation: 'conflict-political',
  slow_burn: 'conflict-political',
  gdelt: 'conflict-political',
  food: 'infrastructure-economy',
  nuclear: 'infrastructure-economy',
  camp: 'infrastructure-economy',
  enso: 'infrastructure-economy',
}

export type Weakness = 'low' | 'medium' | 'high'

export function departmentsTouched(hypothesis: Pick<Hypothesis, 'evidence'>): Department[] {
  const found = new Set<Department>()
  for (const item of hypothesis.evidence) {
    const dept = KEY_DEPARTMENT[item.type]
    if (dept) found.add(dept)
  }
  return [...found]
}

export function structureOf(input: {
  hunters: number
  departments: number
  weakness: Weakness
  evidence: number
}): { stage: 1 | 2 | 3 | 4 | 5; confidence: 'low' | 'medium' | 'high'; possibility: 'low' | 'medium' | 'high' } {
  let score = Math.min(3, Math.max(0, input.hunters))
  score += input.departments >= 3 ? 2 : input.departments >= 2 ? 1 : 0
  score += input.evidence >= 3 ? 2 : input.evidence >= 1 ? 1 : 0
  if (input.weakness === 'high') score -= 2
  else if (input.weakness === 'medium') score -= 1
  const stage = (score >= 6 ? 5 : score >= 5 ? 4 : score >= 3 ? 3 : score >= 2 ? 2 : 1) as 1 | 2 | 3 | 4 | 5
  const confidence = stage >= 4 ? 'high' : stage >= 3 ? 'medium' : 'low'
  return { stage, confidence, possibility: confidence }
}

export function weaknessOf(note: string, severity: string | undefined): Weakness {
  if (severity === 'low' || severity === 'medium' || severity === 'high') return severity
  if (!note.trim()) return 'low'
  if (/\b(fatal|unsupported|contradict|no evidence)\b/i.test(note)) return 'high'
  return 'medium'
}
