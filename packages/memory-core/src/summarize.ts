import type { MemoryRecord } from '@dsh-memory/ports'

export const DEFAULT_SUMMARY_THRESHOLD = 3.0

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
