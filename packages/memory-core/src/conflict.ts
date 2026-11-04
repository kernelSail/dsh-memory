import type { ConflictPolicy, MemoryRecord, SourceSpeaker } from '@dsh-memory/ports'

/** 来源可信度（§11.4.1 第 2 级） */
const SOURCE_RANK: Record<SourceSpeaker, number> = {
  user: 4,
  tool: 3,
  assistant: 2,
  imported: 1,
}

export interface Resolution {
  winnerMemoryId: string | null
  policy: ConflictPolicy
  reason: string
}

function newestFirst(members: MemoryRecord[]): MemoryRecord[] {
  return [...members].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

/** 记忆在给定时间点是否有效（null 表示开区间） */
export function isValidAt(memory: MemoryRecord, at: Date): boolean {
  const from = memory.validFrom ? Date.parse(memory.validFrom) : Number.NEGATIVE_INFINITY
  const until = memory.validUntil ? Date.parse(memory.validUntil) : Number.POSITIVE_INFINITY
  const t = at.getTime()
  if (Number.isFinite(from) && t < from) return false
  if (Number.isFinite(until) && t > until) return false
  return true
}

/**
 * 冲突裁决（§11.4.1）：按序短路。
 * 1) TEMPORAL（有效时间窗）→ 2) 来源优先级 → 3) 置信度差 ≥ 0.2 → 4) 新近 → 5) UNRESOLVED
 */
export function resolveConflict(members: MemoryRecord[], at: Date = new Date()): Resolution {
  if (members.length === 0) {
    return { winnerMemoryId: null, policy: 'UNRESOLVED', reason: '无冲突成员' }
  }
  if (members.length === 1) {
    return { winnerMemoryId: members[0]?.id ?? null, policy: 'SOURCE_PRIORITY', reason: '单成员' }
  }

  // TEMPORAL：若恰好只有一条在参考时间点有效，直接胜出
  const validNow = members.filter((m) => isValidAt(m, at))
  if (validNow.length === 1) {
    const winner = validNow[0] as MemoryRecord
    return { winnerMemoryId: winner.id, policy: 'TEMPORAL', reason: '参考时间点仅一条有效' }
  }

  const ranks = members.map((m) => SOURCE_RANK[m.sourceSpeaker] ?? 0)
  const topRank = Math.max(...ranks)
  const top = members.filter((m) => (SOURCE_RANK[m.sourceSpeaker] ?? 0) === topRank)
  if (top.length === 1) {
    const winner = top[0] as MemoryRecord
    return {
      winnerMemoryId: winner.id,
      policy: 'SOURCE_PRIORITY',
      reason: `来源优先级：${winner.sourceSpeaker}`,
    }
  }

  const byConfidence = [...top].sort((a, b) => b.confidence - a.confidence)
  const first = byConfidence[0] as MemoryRecord
  const second = byConfidence[1] as MemoryRecord
  if (first.confidence - second.confidence >= 0.2) {
    return {
      winnerMemoryId: first.id,
      policy: 'CONFIDENCE',
      reason: `置信度差 ${(first.confidence - second.confidence).toFixed(2)} ≥ 0.2`,
    }
  }

  const byTime = newestFirst(top)
  const latest = byTime[0] as MemoryRecord
  const previous = byTime[1] as MemoryRecord
  if (Date.parse(latest.updatedAt) > Date.parse(previous.updatedAt)) {
    return { winnerMemoryId: latest.id, policy: 'LATEST', reason: '新近优先' }
  }

  return { winnerMemoryId: null, policy: 'UNRESOLVED', reason: '来源/置信度/时间均无法区分' }
}

/** 冲突组内是否必须成组注入（§11.4.1 硬约束 1） */
export function isUnresolved(policy: ConflictPolicy): boolean {
  return policy === 'UNRESOLVED'
}
