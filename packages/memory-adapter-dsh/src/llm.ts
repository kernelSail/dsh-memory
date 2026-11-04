import type { LLMPort, LLMRequest } from '@dsh-memory/ports'

/** DSH `ctx.llm.stream` 的最小结构类型（§20.5 LLMPort 的 DSH 实现） */
export interface DshStreamChunk {
  type: string
  index?: number
  text?: string
  reason?: { kind?: string }
  usage?: unknown
}

export interface DshLlmStreamLike {
  stream(options: Record<string, unknown>): AsyncIterable<DshStreamChunk>
}

export interface DshLlmPortOptions {
  provider: string
  model: string
  /** 固定系统提示（可选） */
  system?: string
  timeoutMs?: number
}

export interface DshLlmPort extends LLMPort {
  readonly provider: string
  readonly model: string
  lastUsage(): unknown
}

/**
 * 把 `ctx.llm.stream({provider, model, messages})` 的 token 级分片组装成文本。
 * 协议依据 DSH 文档：chunks: block-start / text-delta / usage / finish（terminate）。
 */
export function createDshLlmPort(llm: DshLlmStreamLike, options: DshLlmPortOptions): DshLlmPort {
  let usage: unknown

  return {
    provider: options.provider,
    model: options.model,
    lastUsage: () => usage,

    async complete<T = string>(request: LLMRequest): Promise<T> {
      const messages: Array<{ role: string; content: Array<{ type: 'text'; text: string }> }> = []
      if (options.system) {
        messages.push({ role: 'system', content: [{ type: 'text', text: options.system }] })
      }
      messages.push({ role: 'user', content: [{ type: 'text', text: request.prompt }] })

      const streamOptions: Record<string, unknown> = {
        provider: options.provider,
        model: options.model,
        messages,
      }
      if (request.timeoutMs ?? options.timeoutMs) {
        streamOptions.signal = AbortSignal.timeout(request.timeoutMs ?? options.timeoutMs ?? 20_000)
      }

      let text = ''
      for await (const chunk of llm.stream(streamOptions)) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          text += chunk.text
        } else if (chunk.type === 'usage') {
          usage = chunk.usage
        } else if (chunk.type === 'finish') {
          const kind = chunk.reason?.kind
          if (kind && kind !== 'stop') {
            throw new Error(`llm finish: ${kind}`)
          }
        }
      }
      if (!text.trim()) {
        throw new Error('llm returned empty text')
      }
      return text as T
    },
  }
}
