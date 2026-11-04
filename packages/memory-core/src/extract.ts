import type { LLMPort, MemoryCandidate, Modality, Polarity, SourceSpeaker } from '@dsh-memory/ports'

export interface ExtractMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | string
  content: string
}

export interface ExtractInput {
  messages: ExtractMessage[]
  defaultTopicId?: string
  sourceRefs?: string[]
}

export interface ExtractDeps {
  llm: LLMPort
  maxCandidates?: number
}

const MODALITIES: Modality[] = ['asserted', 'planned', 'hypothetical', 'question', 'quoted']
const POLARITIES: Polarity[] = ['affirm', 'negate']

export function buildExtractPrompt(input: ExtractInput): string {
  const dialog = input.messages
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n')
  return [
    '你是长期记忆提取器。从下面这段对话中提取值得长期记住的信息。',
    '要求：',
    '1. 一条记忆只表达一个事实槽位（entity + attribute + value）。',
    '2. 寒暄、确认语、过程性描述不提取。',
    '3. 假设/计划/否定必须保留模态：modality ∈ asserted|planned|hypothetical|question|quoted，polarity ∈ affirm|negate。',
    '4. conditions/exceptions 仅在原文明确时填写。',
    '5. 输出 JSON：{"candidates":[{"topicId":"...","entity":"...","attribute":"...","value":"...","content":"...","modality":"asserted","polarity":"affirm","conditions":{},"exceptions":[]}]}',
    '',
    '对话：',
    dialog,
  ].join('\n')
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 解析并校验模型输出；非法条目丢弃而不是让整批失败 */
export function parseCandidates(raw: unknown, input: ExtractInput = { messages: [] }, maxCandidates = 8): MemoryCandidate[] {
  let payload = raw
  if (typeof payload === 'string') {
    const text = payload.trim()
    if (!text) return []
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      return []
    }
  }
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { candidates?: unknown }).candidates)
      ? (payload as { candidates: unknown[] }).candidates
      : []

  const candidates: MemoryCandidate[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const entity = asString(raw.entity)
    const attribute = asString(raw.attribute)
    const value = asString(raw.value)
    if (!entity || !attribute || !value) continue

    const modality = MODALITIES.includes(raw.modality as Modality) ? (raw.modality as Modality) : 'asserted'
    const polarity = POLARITIES.includes(raw.polarity as Polarity) ? (raw.polarity as Polarity) : 'affirm'
    const conditions =
      raw.conditions && typeof raw.conditions === 'object' && !Array.isArray(raw.conditions)
        ? Object.fromEntries(
            Object.entries(raw.conditions as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
          )
        : undefined
    const exceptions = Array.isArray(raw.exceptions) ? raw.exceptions.map(String) : undefined

    candidates.push({
      topicId: asString(raw.topicId) || input.defaultTopicId || 'default',
      entity,
      attribute,
      value,
      content: asString(raw.content) || value,
      modality,
      polarity,
      ...(conditions ? { conditions } : {}),
      ...(exceptions ? { exceptions } : {}),
      sourceSpeaker: 'user',
      sourceRefs: input.sourceRefs ?? [],
    })
    if (candidates.length >= maxCandidates) break
  }
  return candidates
}

/** 提取候选（失败 fail-open：返回空数组，不阻塞主对话） */
export async function extractCandidates(input: ExtractInput, deps: ExtractDeps): Promise<MemoryCandidate[]> {
  try {
    const raw = await deps.llm.complete<unknown>({
      prompt: buildExtractPrompt(input),
      timeoutMs: 20_000,
    })
    return parseCandidates(raw, input, deps.maxCandidates ?? 8).map((candidate) => ({
      ...candidate,
      sourceSpeaker: inferSpeaker(input, candidate),
    }))
  } catch {
    return []
  }
}

function inferSpeaker(input: ExtractInput, _candidate: MemoryCandidate): SourceSpeaker {
  const lastUser = [...input.messages].reverse().find((message) => message.role === 'user')
  return lastUser ? 'user' : 'assistant'
}
