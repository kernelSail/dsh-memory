import type { DecisionKind, MemoryRecord, SummaryFact } from '@dsh-memory/ports'
import { normalizeValue } from './normalize.js'

export interface DecideInput {
  factKey: string
  valueHash: string
  contextHash: string
  value: string
  hasConditions: boolean
  hasExceptions: boolean
  /** 同 fact_key 的 ACTIVE 记忆 */
  activeSameFactKey: MemoryRecord[]
  /** 摘要已表达的事实槽位 */
  summaryFacts: SummaryFact[]
  /** pending 中同 fact_key 的最大 novelty（用于避免重复累加） */
  pendingMaxNovelty?: number
}

export interface DecideResult {
  decision: DecisionKind
  noveltyScore: number
  reason: string
  needsModel: boolean
}

/** 第一级：确定性规则判定（§4.4） */
export function decide(input: DecideInput): DecideResult {
  const { factKey, valueHash, contextHash, activeSameFactKey, summaryFacts } = input

  if (!normalizeValue(input.value)) {
    return { decision: 'NO_GAIN', noveltyScore: 0, reason: '归一化后无有效信息', needsModel: false }
  }

  const summaryHit = summaryFacts.find((f) => f.factKey === factKey)

  if (activeSameFactKey.length === 0) {
    if (summaryHit && summaryHit.valueHash === valueHash) {
      return { decision: 'PARAPHRASE', noveltyScore: 0.2, reason: '摘要已表达同一事实', needsModel: false }
    }
    if (summaryHit) {
      return { decision: 'CORRECTION', noveltyScore: 0.9, reason: '摘要已表达同一槽位但值不同', needsModel: true }
    }
    return { decision: 'NEW_FACT', noveltyScore: 1.0, reason: '新事实槽位', needsModel: false }
  }

  const exact = activeSameFactKey.find((m) => m.valueHash === valueHash && m.contextHash === contextHash)
  if (exact) {
    return { decision: 'DUPLICATE', noveltyScore: 0, reason: '事实、值与上下文均相同', needsModel: false }
  }

  const sameValue = activeSameFactKey.filter((m) => m.valueHash === valueHash)
  if (sameValue.length > 0) {
    if (input.hasExceptions) {
      return { decision: 'NEW_EXCEPTION', noveltyScore: 0.8, reason: '同事实新增例外', needsModel: false }
    }
    return { decision: 'NEW_CONDITION', noveltyScore: 0.8, reason: '同事实新增条件', needsModel: false }
  }

  const sameContext = activeSameFactKey.some((m) => m.contextHash === contextHash)
  if (sameContext) {
    return { decision: 'CORRECTION', noveltyScore: 0.9, reason: '同槽位值改变，需二级确认', needsModel: true }
  }

  return { decision: 'CORRECTION', noveltyScore: 0.9, reason: '值不同且上下文不同，需二级确认', needsModel: true }
}

/** pending 累计口径：同一 fact_key 只取最大值（§4.4） */
export function pendingNoveltyAfter(pendingMaxNovelty: number | undefined, novelty: number): number {
  return Math.max(pendingMaxNovelty ?? 0, novelty)
}
