/**
 * DSH 记忆插件（cordis 适配器）。
 *
 * 职责：只做宿主接线，不含记忆规则（去重 / 判定 / 摘要 / 裁决都在 memory-core）。
 * - `ctx.llm.stream` → LLMPort（见 ./llm.ts）
 * - `ctx.systemPrompt.section` → 记忆上下文注入
 * - `ctx.tools.register` → memory_search 工具
 * - `ctx.on('session/event')` → 捕获用户消息 / turn 结束触发提取与写入
 *
 * fail-open：任何钩子失败都只打日志，不阻塞主对话。
 */
import type { ClockPort, LLMPort, MemoryContext, StoragePort } from '@dsh-memory/ports'
import { createStorage } from '@dsh-memory/storage-sqlite'
import {
  extractCandidates,
  ingestCandidate,
  renderMemoryContext,
  retrieve,
  runSummary,
} from '@dsh-memory/core'
import { createDshLlmPort, type DshLlmStreamLike } from './llm.js'

export interface MemoryPluginConfig {
  enabled: boolean
  tenantId: string
  defaultTopicId: string
  /** ':memory:' 或本地文件路径 */
  dbPath: string
  provider: string
  model: string
  system: string | null
  noveltyThreshold: number
  maxMemories: number
  tokenBudget: number
  /** systemPrompt 段顺序（越小越靠前） */
  sectionOrder: number
  maxExtractPerTurn: number
  /** 每 N 轮对话做一次提取（1 = 每轮）；降低 LLM 调用成本 */
  extractBatchTurns: number
}

export const defaultConfig: MemoryPluginConfig = {
  enabled: true,
  tenantId: 'default',
  defaultTopicId: 'default',
  dbPath: ':memory:',
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  system: null,
  noveltyThreshold: 3.0,
  maxMemories: 12,
  tokenBudget: 4000,
  sectionOrder: 50,
  maxExtractPerTurn: 8,
  extractBatchTurns: 4,
}

/** DSH cordis ctx 的最小结构类型（只用到的字段） */
export interface DshContextLike {
  llm?: DshLlmStreamLike
  systemPrompt?: {
    section(entry: {
      name: string
      order: number
      text: string | (() => string)
      interpolate?: boolean
    }): unknown
  }
  tools?: { register(tool: unknown): unknown }
  on?: (event: string, handler: (session: unknown, event: unknown) => void) => unknown
  logger?: { warn(message: string): void; info?(message: string): void }
}

export interface TurnMessage {
  role: string
  content: string
}

export interface TurnRecord {
  sessionId: string
  turnId: string
  messages: TurnMessage[]
}

export interface TurnResult {
  ingested: number
  summarized: boolean
  degraded: boolean
}

export interface MemoryAdapter {
  beforeModelCall(prompt: string, topicId?: string): MemoryContext
  afterTurn(turn: TurnRecord): Promise<TurnResult>
  onSessionEnd(sessionId: string, topicId?: string): Promise<void>
  render(context: MemoryContext): string
}

export interface MemoryPlugin {
  config: MemoryPluginConfig
  storage: StoragePort
  adapter: MemoryAdapter
  /** 等待所有进行中的写入/总结（测试与关停用） */
  flush(): Promise<void>
  dispose(): void
}

function warn(ctx: DshContextLike, message: string): void {
  try {
    ctx.logger?.warn(`[memory] ${message}`)
  } catch {
    // ignore logger failures
  }
}

function extractText(data: unknown): string {
  if (typeof data === 'string') return data
  if (!data || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  const content = record.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === 'object' ? String((block as { text?: unknown }).text ?? '') : ''))
      .join('')
  }
  if (typeof record.text === 'string') return record.text
  return ''
}

/** cordis 插件入口 */
export function apply(ctx: DshContextLike, config: Partial<MemoryPluginConfig> = {}): MemoryPlugin | null {
  const cfg: MemoryPluginConfig = { ...defaultConfig, ...config }
  if (!cfg.enabled) return null

  const storage = createStorage({ path: cfg.dbPath })
  const clock: ClockPort = { now: () => new Date() }
  const llm: LLMPort | undefined = ctx.llm
    ? createDshLlmPort(ctx.llm, {
        provider: cfg.provider,
        model: cfg.model,
        ...(cfg.system ? { system: cfg.system } : {}),
      })
    : undefined

  const pending = new Map<string, TurnMessage[]>()
  const inflight = new Set<Promise<unknown>>()
  let lastQuery = ''

  function track<T>(promise: Promise<T>): Promise<T> {
    inflight.add(promise as Promise<unknown>)
    void (promise as Promise<unknown>).finally(() => inflight.delete(promise as Promise<unknown>))
    return promise
  }

  const turnBuffer: TurnRecord[] = []

  /** 批量提取：N 轮对话合并为一次 LLM 调用（§7 成本优化） */
  async function extractBatch(turns: TurnRecord[]): Promise<TurnResult> {
    if (!llm) {
      warn(ctx, 'afterTurn skipped: no llm service')
      return { ingested: 0, summarized: false, degraded: true }
    }
    const messages = turns.flatMap((turn) => turn.messages.filter((message) => message.role !== 'system'))
    if (messages.length === 0) return { ingested: 0, summarized: false, degraded: false }

    const sourceRefs = turns.map((turn) => turn.turnId)
    const candidates = await extractCandidates(
      {
        messages,
        defaultTopicId: cfg.defaultTopicId,
        topicHints: storage.listTopics(cfg.tenantId),
        sourceRefs,
      },
      { llm, maxCandidates: cfg.maxExtractPerTurn },
    )

    let ingested = 0
    let summarized = false
    const summaryTopics = new Set<string>()

    for (const candidate of candidates) {
      try {
        const result = ingestCandidate(
          { ...candidate, sourceRefs },
          { storage, clock, noveltyThreshold: cfg.noveltyThreshold, tenantId: cfg.tenantId },
        )
        if (result.memoryId) ingested++
        if (result.summarizeSuggested) summaryTopics.add(candidate.topicId)
      } catch (error) {
        warn(ctx, `ingest degraded: ${String(error)}`)
      }
    }

    for (const topicId of summaryTopics) {
      try {
        const summary = await runSummary(topicId, {
          storage,
          clock,
          llm,
          tenantId: cfg.tenantId,
          noveltyThreshold: cfg.noveltyThreshold,
          force: true,
        })
        if (summary.status === 'ACTIVE') summarized = true
      } catch (error) {
        warn(ctx, `summary degraded: ${String(error)}`)
      }
    }

    return { ingested, summarized, degraded: false }
  }

  function enqueueTurn(turn: TurnRecord): void {
    turnBuffer.push(turn)
    if (turnBuffer.length < cfg.extractBatchTurns) return
    const batch = turnBuffer.splice(0, turnBuffer.length)
    track(extractBatch(batch)).catch((error) => warn(ctx, `batch ingest degraded: ${String(error)}`))
  }

  const adapter: MemoryAdapter = {
    beforeModelCall(prompt, topicId) {
      try {
        return retrieve(storage, {
          query: prompt || lastQuery,
          topicId: topicId ?? cfg.defaultTopicId,
          tokenBudget: cfg.tokenBudget,
          maxMemories: cfg.maxMemories,
        })
      } catch (error) {
        warn(ctx, `retrieve degraded: ${String(error)}`)
        return { topicId: topicId ?? null, memories: [], conflicts: [], tokensUsed: 0, degraded: true }
      }
    },

    async afterTurn(turn): Promise<TurnResult> {
      // 直接调用不经过批量缓冲（供宿主/测试手动触发）
      return extractBatch([turn])
    },

    async onSessionEnd(_sessionId, topicId): Promise<void> {
      try {
        while (turnBuffer.length > 0) {
          const batch = turnBuffer.splice(0, turnBuffer.length)
          await extractBatch(batch)
        }
      } catch {
        // ignore
      }
      if (!llm) return
      try {
        await runSummary(topicId ?? cfg.defaultTopicId, {
          storage,
          clock,
          llm,
          tenantId: cfg.tenantId,
          noveltyThreshold: cfg.noveltyThreshold,
        })
      } catch (error) {
        warn(ctx, `session-end summary degraded: ${String(error)}`)
      }
    },

    render: renderMemoryContext,
  }

  // 1) 系统提示词注入：每次组装时按最近用户消息检索（同步，受 token 预算约束）
  ctx.systemPrompt?.section({
    name: 'memory:context',
    order: cfg.sectionOrder,
    text: () => {
      if (!lastQuery) return ''
      const context = adapter.beforeModelCall(lastQuery, cfg.defaultTopicId)
      return adapter.render(context)
    },
  })

  // 2) 工具：memory_search
  ctx.tools?.register({
    name: 'memory_search',
    description: '检索长期记忆（事实、决策、偏好、约束），返回相关记忆与未消解冲突。',
    parameters: {
      query: { type: 'string', required: true, description: '检索关键词或问题' },
      topicId: { type: 'string', description: '限定主题（可选）' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args: unknown, value: unknown) => [
        { type: 'text', text: JSON.stringify(value) },
      ],
    },
    async execute(args: Record<string, unknown>) {
      const topicId = typeof args.topicId === 'string' ? args.topicId : undefined
      const context = adapter.beforeModelCall(String(args.query ?? ''), topicId)
      return {
        memories: context.memories.map((memory) => ({ content: memory.content, modality: memory.modality })),
        conflicts: context.conflicts,
        degraded: context.degraded,
      }
    },
  })

  // 2b) 工具：memory_write（显式写入一条结构化记忆）
  ctx.tools?.register({
    name: 'memory_write',
    description: '显式写入一条长期记忆（事实槽位：entity + attribute + value）。用户要求「记住」时使用。',
    parameters: {
      entity: { type: 'string', required: true, description: '实体（项目/用户/技术/组织）' },
      attribute: { type: 'string', required: true, description: '属性名' },
      value: { type: 'string', required: true, description: '属性值' },
      content: { type: 'string', description: '人类可读表述（可选）' },
      topicId: { type: 'string', description: '主题（可选，默认 defaultTopicId）' },
      modality: { type: 'string', description: 'asserted|planned|hypothetical|question|quoted' },
      validFrom: { type: 'string', description: '生效时间 ISO（可选）' },
      validUntil: { type: 'string', description: '失效时间 ISO（可选）' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args: Record<string, unknown>) {
      const modalityValues = ['asserted', 'planned', 'hypothetical', 'question', 'quoted']
      const modality = modalityValues.includes(String(args.modality))
        ? (String(args.modality) as 'asserted' | 'planned' | 'hypothetical' | 'question' | 'quoted')
        : 'asserted'
      const result = ingestCandidate(
        {
          tenantId: cfg.tenantId,
          topicId: typeof args.topicId === 'string' && args.topicId ? args.topicId : cfg.defaultTopicId,
          entity: String(args.entity ?? ''),
          attribute: String(args.attribute ?? ''),
          value: String(args.value ?? ''),
          content: typeof args.content === 'string' ? args.content : undefined,
          modality,
          sourceSpeaker: 'user',
          sourceRefs: ['memory_write'],
          intent: 'correct',
          ...(typeof args.validFrom === 'string' ? { validFrom: args.validFrom } : {}),
          ...(typeof args.validUntil === 'string' ? { validUntil: args.validUntil } : {}),
        },
        { storage, clock, tenantId: cfg.tenantId, noveltyThreshold: cfg.noveltyThreshold },
      )
      return {
        decision: result.decision,
        memoryId: result.memoryId,
        noveltyScore: result.noveltyScore,
        pendingNovelty: result.pendingNovelty,
      }
    },
  })

  // 3) 会话事件：累积一轮消息，turn/end 时提取写入（不阻塞）
  ctx.on?.('session/event', (session: unknown, event: unknown) => {
    const evt = event as { type?: string; data?: Record<string, unknown> } | undefined
    if (!evt?.type) return
    const data = evt.data ?? {}
    const sessionRecord = session as { header?: { id?: unknown }; id?: unknown } | undefined
    const sessionId =
      typeof sessionRecord?.header?.id === 'string'
        ? sessionRecord.header.id
        : typeof sessionRecord?.id === 'string'
          ? sessionRecord.id
          : 'default'

    if (evt.type === 'user/message') {
      // 只取真实用户消息，跳过 runtime context / skill reminder 等注入消息
      const source = data.source as { kind?: string } | undefined
      if (data.role !== 'user') return
      if (source?.kind && source.kind !== 'user') return
      const text = extractText(data)
      if (text) {
        lastQuery = text
        const list = pending.get(sessionId) ?? []
        list.push({ role: 'user', content: text })
        pending.set(sessionId, list)
      }
      return
    }
    if (evt.type === 'assistant/message') {
      const message = (data.message ?? data) as Record<string, unknown>
      const text = extractText(message)
      if (text) {
        const list = pending.get(sessionId) ?? []
        list.push({ role: 'assistant', content: text })
        pending.set(sessionId, list)
      }
      return
    }
    if (evt.type === 'turn/end') {
      const messages = pending.get(sessionId) ?? []
      pending.set(sessionId, [])
      if (messages.length === 0) return
      const turnId = data.turn !== undefined ? String(data.turn) : String(data.seq ?? Date.now())
      enqueueTurn({ sessionId, turnId, messages })
    }
  })

  return {
    config: cfg,
    storage,
    adapter,
    async flush() {
      // 先处理未满一批的尾巴，再等待在途提取/总结
      while (turnBuffer.length > 0 || inflight.size > 0) {
        if (turnBuffer.length > 0) {
          const batch = turnBuffer.splice(0, turnBuffer.length)
          await extractBatch(batch)
        }
        if (inflight.size > 0) {
          await Promise.allSettled([...inflight])
        }
      }
    },
    dispose() {
      pending.clear()
      storage.close()
    },
  }
}
