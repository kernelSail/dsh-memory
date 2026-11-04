import type { LLMPort, MemoryCandidate, Modality, Polarity, SourceSpeaker } from '@dsh-memory/ports'

export interface ExtractMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | string
  content: string
}

export interface ExtractInput {
  messages: ExtractMessage[]
  defaultTopicId?: string
  /** 已存在主题，提示模型优先复用 */
  topicHints?: string[]
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
  const known = (input.topicHints ?? []).slice(0, 20)
  return [
    '你是长期记忆提取器。从下面这段对话中提取值得长期记住的信息。',
    '要求：',
    '1. 一条记忆只表达一个事实槽位（entity + attribute + value）。',
    '2. 寒暄、确认语、过程性描述不提取。',
    '3. 假设/计划/否定必须保留模态：modality ∈ asserted|planned|hypothetical|question|quoted，polarity ∈ affirm|negate。',
    '4. conditions/exceptions 仅在原文明确时填写；有明确生效时间时填 validFrom/validUntil（ISO 时间）。',
    '5. topicId 用小写 slug（如 project_architecture）；**优先复用已有主题**，没有合适的再新建。',
    known.length > 0 ? `已有主题：${known.join(', ')}` : '已有主题：（无）',
    '6. 输出 JSON：{"candidates":[{"topicId":"...","entity":"...","attribute":"...","value":"...","content":"...","modality":"asserted","polarity":"affirm","conditions":{},"exceptions":[],"validFrom":null,"validUntil":null}]}',
    '',
    '对话：',
    dialog,
  ].join('\n')
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function topicSlug(value: string): string {
  const normalized = value.normalize('NFKC').trim().toLowerCase()
  const slug = normalized.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '')
  return slug.slice(0, 60)
}

function asIso(value: unknown): string | null {
  const text = asString(value)
  if (!text) return null
  const time = Date.parse(text)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
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

    const rawTopic = topicSlug(asString(raw.topicId))
    const topicId = rawTopic || input.defaultTopicId || 'default'
    const validFrom = asIso(raw.validFrom)
    const validUntil = asIso(raw.validUntil)

    candidates.push({
      topicId,
      entity,
      attribute,
      value,
      content: asString(raw.content) || value,
      modality,
      polarity,
      ...(conditions ? { conditions } : {}),
      ...(exceptions ? { exceptions } : {}),
      ...(validFrom ? { validFrom } : {}),
      ...(validUntil ? { validUntil } : {}),
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
