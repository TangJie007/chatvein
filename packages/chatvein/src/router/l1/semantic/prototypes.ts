/**
 * 路由语义原型库（生产用种子集，非 demo）。
 *
 * Domain 仅 general | code；原 office 说法并入 general。
 */
import type { Domain, Lane } from '../../types'
import {
  AGENTIC_CODE,
  AGENTIC_GENERAL,
  AGENTIC_OFFICE,
  DIRECT_GENERAL,
  ORCHESTRATED_CODE,
  ORCHESTRATED_OFFICE,
} from './sets'

export interface Prototype {
  lane: Lane
  domain: Domain
  texts: string[]
}

export const DEFAULT_PROTOTYPES: Prototype[] = [
  { lane: 'direct', domain: 'general', texts: DIRECT_GENERAL },
  {
    lane: 'agentic',
    domain: 'general',
    texts: [...AGENTIC_GENERAL, ...AGENTIC_OFFICE],
  },
  { lane: 'agentic', domain: 'code', texts: AGENTIC_CODE },
  { lane: 'orchestrated', domain: 'code', texts: ORCHESTRATED_CODE },
  {
    lane: 'orchestrated',
    domain: 'general',
    texts: ORCHESTRATED_OFFICE,
  },
]

/** 各类条数（便于单测与运营巡检） */
export function prototypeStats(
  list: Prototype[] = DEFAULT_PROTOTYPES,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of list) {
    out[`${p.lane}|${p.domain}`] = p.texts.length
  }
  return out
}

export function prototypeTotal(list: Prototype[] = DEFAULT_PROTOTYPES): number {
  return list.reduce((n, p) => n + p.texts.length, 0)
}
