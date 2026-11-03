import type {
  ClockPort,
  LLMPort,
  MemoryRecord,
  StoragePort,
  SummaryRecord,
  SummaryStatus,
} from '@dsh-memory/ports'
import { shortHash } from './normalize.js'

export const DEFAULT_SUMMARY_THRESHOLD = 3.0
const MIN_SUMMARY_CHARS = 20

/** §7.3：累计 novelty 达到阈值才进入总结候选 */
export function shouldSummarize(pendingNovelty: number, threshold: number = DEFAULT_SUMMARY_THRESHOLD): boolean {
  return pendingNovelty >= threshold
}

export interface SummaryPromptInput {
  topicId: string
  oldSummary: string | null
  memories: MemoryRecord[]
}

/** 增量总结提示词（模板外置，实际由 PromptRegistry 提供） */
export function buildSummaryPrompt(input: SummaryPromptInput): string {
  const memoryLines = input.memories
    .map((m) => `- [${m.modality}] ${m.content}${m.conditions !== '{}' ? `（条件：${m.conditions}）` : ''}`)
    .join('\n')
  return [
    '你是长期记忆的摘要器。基于旧摘要与新增记忆，生成新的主题摘要。',
    '要求：保留条件与例外；否定与计划不得改写为事实；不合并冲突事实；不写未包含的信息。',
    `主题：${input.topicId}`,
    `旧摘要：${input.oldSummary ?? '（无）'}`,
    `新增记忆：`,
    memoryLines,
    '输出 JSON：{"summary":"..."}',
  ].join('\n')
}

/** 摘要校验提示词（规则优先，模型兜底） */
export function buildVerifyPrompt(summary: string, memories: MemoryRecord[]): string {
  return [
    '校验摘要是否忠实于源记忆。检查：覆盖率、事实一致性、条件/例外/否定是否保留。',
    `摘要：${summary}`,
    `源记忆：`,
    memories.map((m) => `- ${m.content}`).join('\n'),
    '输出 JSON：{"pass":true|false,"issues":["..."]}',
  ].join('\n')
}

export interface VerifyResult {
  ok: boolean
  reason: string
}

/** 规则校验（§19.3 verify_pass / verify_fail） */
export function verifySummary(input: {
  content: string
  oldSummary: SummaryRecord | null
  memories: MemoryRecord[]
}): VerifyResult {
  const content = input.content.trim()
  if (content.length < MIN_SUMMARY_CHARS) {
    return { ok: false, reason: `摘要过短（${content.length} < ${MIN_SUMMARY_CHARS}）` }
  }
  if (input.oldSummary && content === input.oldSummary.content.trim()) {
    return { ok: false, reason: '摘要与旧版完全相同，无有效变化' }
  }
  const sourceChars = input.memories.reduce((sum, m) => sum + m.content.length, 0) + (input.oldSummary?.content.length ?? 0)
  if (sourceChars > 0 && content.length > sourceChars * 1.5) {
    return { ok: false, reason: '摘要长度超过源材料 1.5 倍，疑似幻觉' }
  }
  return { ok: true, reason: 'ok' }
}

function parseSummary(raw: unknown): string {
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text) as { summary?: unknown }
        if (typeof parsed.summary === 'string') return parsed.summary.trim()
      } catch {
        // 落到下方按纯文本处理
      }
    }
    return text
  }
  if (raw && typeof raw === 'object') {
    const maybe = raw as { summary?: unknown }
    if (typeof maybe.summary === 'string') return maybe.summary.trim()
  }
  return ''
}

export interface SummaryDeps {
  storage: StoragePort
  clock: ClockPort
  llm: LLMPort
  tenantId?: string
  noveltyThreshold?: number
  /** 高价值增量（如用户修正）立即总结，跳过阈值检查 */
  force?: boolean
}

export interface SummaryRunResult {
  ran: boolean
  status: SummaryStatus | 'SKIPPED'
  summaryId?: string
  reason: string
}

/**
 * 增量总结主流程（§7.5 / §19.3）：
 * pending 取阈值 → LLM 生成 → 规则校验 → DRAFT → VALIDATED → CAS 激活（旧版 SUPERSEDED）→ 清 pending
 * 任一校验失败：不激活、pending 保留。
 */
export async function runSummary(topicId: string, deps: SummaryDeps): Promise<SummaryRunResult> {
  const threshold = deps.noveltyThreshold ?? DEFAULT_SUMMARY_THRESHOLD
  const pendingNovelty = deps.storage.pendingNovelty(topicId)
  if (!deps.force && pendingNovelty < threshold) {
    return { ran: false, status: 'SKIPPED', reason: `pending novelty ${pendingNovelty.toFixed(2)} < ${threshold}` }
  }

  const pendingIds = deps.storage.pendingMemoryIds(topicId)
  const memories = pendingIds
    .map((id) => deps.storage.getMemory(id))
    .filter((m): m is MemoryRecord => m !== null && m.status === 'ACTIVE')
  if (memories.length === 0) {
    return { ran: false, status: 'SKIPPED', reason: 'no active pending memories' }
  }

  const old = deps.storage.getActiveSummary(topicId)
  const prompt = buildSummaryPrompt({ topicId, oldSummary: old?.content ?? null, memories })

  let content: string
  try {
    const raw = await deps.llm.complete<unknown>({ prompt, timeoutMs: 20_000 })
    content = parseSummary(raw)
  } catch (error) {
    return { ran: true, status: 'DISCARDED', reason: `llm failed: ${String(error)}` }
  }

  const verify = verifySummary({ content, oldSummary: old, memories })
  if (!verify.ok) {
    return { ran: true, status: 'DISCARDED', reason: verify.reason }
  }

  const now = deps.clock.now()
  const version = (old?.version ?? 0) + 1
  const record: SummaryRecord = {
    summaryId: `sum_${shortHash([topicId, version, now.toISOString()].join('|'))}`,
    tenantId: deps.tenantId ?? 'default',
    topicId,
    content,
    version,
    status: 'DRAFT',
    generationDepth: (old?.generationDepth ?? 0) + 1,
    sourceMemoryIds: [...new Set([...(old?.sourceMemoryIds ?? []), ...memories.map((m) => m.id)])],
    pendingMemoryIds: pendingIds,
    summarizedThrough: memories[memories.length - 1]?.id ?? null,
    compressionMetrics: JSON.stringify({
      promptChars: prompt.length,
      summaryChars: content.length,
      memoryCount: memories.length,
    }),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }

  deps.storage.insertSummary(record)
  deps.storage.updateSummaryStatus(record.summaryId, 'VALIDATED')

  const activated = deps.storage.activateSummary(record.summaryId, version)
  if (!activated) {
    return { ran: true, status: 'DRAFT', summaryId: record.summaryId, reason: 'activate CAS failed (concurrent summary)' }
  }

  deps.storage.clearPending(topicId, pendingIds)
  return { ran: true, status: 'ACTIVE', summaryId: record.summaryId, reason: 'ok' }
}
