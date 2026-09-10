/**
 * Router 层间共享常量（避免 l1 ↔ l0 仅为常量互相 import）。
 */
import type { Band, Lane } from './types'

/** lane → 默认 band（无分类器时的静态兜底） */
export const DEFAULT_BAND: Record<Lane, Band> = {
  direct: 'trivial',
  agentic: 'standard',
  orchestrated: 'complex',
}
