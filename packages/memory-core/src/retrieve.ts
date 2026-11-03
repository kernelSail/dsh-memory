import type { MemoryContext, MemoryRecord, StoragePort } from '@dsh-memory/ports'
import { estimateTokens } from './tokens.js'

export interface RetrieveOptions {
  query: string
  topicId?: string
  tenantId?: string
  /** 注入 token 预算（§12） */
  tokenBudget?: number
  /** 单次注入条数上限（§17.6） */
  maxMemories?: number
}

function recencyScore(record: MemoryRecord, now: Date): number {
  const t = Date.parse(record.updatedAt || record.createdAt)
  if (!Number.isFinite(t)) return 0
  const days = Math.max(0, (now.getTime() - t) / 86_400_000)
  return 1 / (1 + days / 30)
}

/** 规则重排：重要性 + 热度 + 新鲜度（§11.3，热度仅作次级信号） */
export function rankScore(record: MemoryRecord, now: Date = new Date()): number {
  return record.importance * 0.5 + record.hotness * 0.3 + recencyScore(record, now) * 0.2
}

/** 多路召回 → 去重 → 重排 → 预算组装（§11 / §12） */
export function retrieve(storage: StoragePort, options: RetrieveOptions): MemoryContext {
  const maxMemories = options.maxMemories ?? 12
  const tokenBudget = options.tokenBudget ?? 4000

  const raw = storage.search(options.query, {
    ...(options.topicId ? { topicId: options.topicId } : {}),
    limit: Math.max(maxMemories * 4, 40),
  })

  const active = raw.filter((m) => m.status === 'ACTIVE')

  // 同一 fact_key 只保留分数最高的一条
  const byFactKey = new Map<string, MemoryRecord>()
  for (const memory of active) {
    const current = byFactKey.get(memory.factKey)
    if (!current || rankScore(memory) > rankScore(current)) {
      byFactKey.set(memory.factKey, memory)
    }
  }

  const ranked = [...byFactKey.values()].sort((a, b) => rankScore(b) - rankScore(a))

  const selected: MemoryRecord[] = []
  let tokensUsed = 0
  for (const memory of ranked) {
    if (selected.length >= maxMemories) break
    const cost = estimateTokens(memory.content) + 20
    if (tokensUsed + cost > tokenBudget) break
    selected.push(memory)
    tokensUsed += cost
  }

  return {
    topicId: options.topicId ?? null,
    memories: selected.map((m) => ({
      memoryId: m.id,
      content: m.content,
      modality: m.modality,
      importance: m.importance,
      sourceRefs: JSON.parse(m.sourceRefs) as string[],
    })),
    tokensUsed,
    degraded: false,
  }
}

/** 渲染为注入文本（宿主可替换模板，§17.4） */
export function renderMemoryContext(context: MemoryContext): string {
  if (context.memories.length === 0) return ''
  const lines: string[] = ['[记忆上下文]']
  for (const memory of context.memories) {
    const tag = memory.modality === 'asserted' ? '' : `（模态：${memory.modality}）`
    lines.push(`- ${memory.content}${tag}`)
  }
  lines.push('[记忆上下文结束]')
  return lines.join('\n')
}
