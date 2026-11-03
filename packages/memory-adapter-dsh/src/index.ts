/**
 * DSH 适配器（cordis 插件骨架）。
 *
 * 设计要点（§17）：
 * - 三钩子：before_model_call / after_turn / on_session_end
 * - 复用宿主：ctx.llm（LLMPort 实现）、ctx.systemPrompt（注入）、ctx.tools（memory_search）
 * - 失败 fail-open，不阻塞主对话
 *
 * 真实接线（DSH 0.2.x）：
 *   ctx.systemPrompt.add({...})
 *   ctx.tools.register(defineTool(...))
 *   ctx.on('turn/end', ...)
 * 本节先给出类型与调用契约，接入时替换为宿主真实 API。
 */
import type { MemoryContext, StoragePort, ClockPort, LLMPort } from '@dsh-memory/ports'
import { ingestCandidate, retrieve, renderMemoryContext, shouldSummarize } from '@dsh-memory/core'

export interface MemoryPluginConfig {
  enabled: boolean
  tenantId: string
  noveltyThreshold: number
  maxMemories: number
  tokenBudget: number
  preTurnTimeoutMs: number
}

export const defaultConfig: MemoryPluginConfig = {
  enabled: true,
  tenantId: 'default',
  noveltyThreshold: 3.0,
  maxMemories: 12,
  tokenBudget: 4000,
  preTurnTimeoutMs: 150,
}

/** 宿主侧最小依赖（真实 DSH 的 ctx 子集） */
export interface MemoryHost {
  storage: StoragePort
  clock: ClockPort
  llm?: LLMPort
  /** 注册 system prompt 片段（§17.4） */
  addPromptSection?(name: string, render: () => string): void
  /** 注册模型可调用的工具（§17.7） */
  registerTool?(tool: MemoryTool): void
  /** 订阅会话事件（§17.7） */
  onSessionEvent?(event: 'turn/end' | 'session/end', handler: (payload: unknown) => void): void
  log?(level: 'debug' | 'info' | 'warn', message: string): void
}

export interface MemoryTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(input: Record<string, unknown>): Promise<unknown>
}

export interface TurnPayload {
  sessionId: string
  turnId: string
  messages: Array<{ role: string; content: string }>
}

export interface MemoryAdapter {
  beforeModelCall(prompt: string, topicId?: string): MemoryContext
  afterTurn(turn: TurnPayload): void
  onSessionEnd(sessionId: string): void
  render(context: MemoryContext): string
}

/** 创建适配器：只做钩子 → 内核调用的翻译，不含记忆规则 */
export function createMemoryAdapter(host: MemoryHost, config: MemoryPluginConfig = defaultConfig): MemoryAdapter {
  const adapter: MemoryAdapter = {
    beforeModelCall(prompt, topicId) {
      try {
        return retrieve(host.storage, {
          query: prompt,
          ...(topicId ? { topicId } : {}),
          tokenBudget: config.tokenBudget,
          maxMemories: config.maxMemories,
        })
      } catch (error) {
        host.log?.('warn', `memory retrieve degraded: ${String(error)}`)
        return { topicId: topicId ?? null, memories: [], conflicts: [], tokensUsed: 0, degraded: true }
      }
    },

    afterTurn(turn) {
      // 真实实现：由 LLM 提取候选后逐条 ingest；这里用消息文本做最小演示
      try {
        for (const message of turn.messages) {
          ingestCandidate(
            {
              topicId: 'default',
              entity: 'session',
              attribute: 'message',
              value: message.content,
              content: message.content,
              sourceSpeaker: message.role === 'user' ? 'user' : 'assistant',
              sourceRefs: [turn.turnId],
            },
            { storage: host.storage, clock: host.clock, noveltyThreshold: config.noveltyThreshold },
          )
        }
      } catch (error) {
        host.log?.('warn', `memory ingest degraded: ${String(error)}`)
      }
    },

    onSessionEnd(_sessionId) {
      // 真实实现：flush pending、触发总结判定
    },

    render: renderMemoryContext,
  }

  host.addPromptSection?.('memory', () => {
    // 真实实现：按当前 query 调 beforeModelCall；这里返回占位，避免假设宿主时序
    return ''
  })

  host.registerTool?.({
    name: 'memory_search',
    description: '检索长期记忆（主题、决策、偏好、约束）',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async execute(input) {
      const context = adapter.beforeModelCall(String(input.query ?? ''))
      return { memories: context.memories, degraded: context.degraded }
    },
  })

  return adapter
}

/** 供未来总结流程使用 */
export function summaryDue(storage: StoragePort, topicId: string, threshold: number): boolean {
  return shouldSummarize(storage.pendingNovelty(topicId), threshold)
}
