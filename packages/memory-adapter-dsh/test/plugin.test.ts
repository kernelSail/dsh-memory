import { describe, expect, it } from 'vitest'
import { apply, type DshContextLike } from '../src/index.js'
import type { DshStreamChunk } from '../src/llm.js'

interface SectionEntry {
  name: string
  order: number
  text: string | (() => string)
}

interface FakeCtx {
  ctx: DshContextLike
  sections: SectionEntry[]
  tools: Array<Record<string, unknown>>
  emit(type: string, data?: Record<string, unknown>): void
}

function makeCtx(payload: unknown): FakeCtx {
  const sections: SectionEntry[] = []
  const tools: Array<Record<string, unknown>> = []
  let handler: ((payload: unknown) => void) | undefined

  const llm = {
    async *stream(): AsyncGenerator<DshStreamChunk> {
      yield { type: 'text-delta', index: 0, text: JSON.stringify(payload) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }

  return {
    ctx: {
      llm,
      systemPrompt: { section(entry) { sections.push(entry as SectionEntry); return () => {} } },
      tools: { register(tool) { tools.push(tool as Record<string, unknown>); return {} } },
      on(event, fn) { if (event === 'session/event') handler = fn },
      logger: { warn: () => {} },
    },
    sections,
    tools,
    emit(type, data = {}) {
      handler?.({ type, data })
    },
  }
}

const extraction = {
  candidates: [
    { entity: 'perm_model', attribute: 'type', value: 'rbac', content: '权限模型采用 RBAC', modality: 'asserted' },
  ],
}

describe('DSH 插件：真实接线', () => {
  it('注册 systemPrompt 段与 memory_search 工具', () => {
    const fake = makeCtx(extraction)
    const plugin = apply(fake.ctx, { dbPath: ':memory:' })
    expect(plugin).not.toBeNull()
    expect(fake.sections.map((s) => s.name)).toContain('memory:context')
    expect(fake.tools.map((t) => t.name)).toContain('memory_search')
    plugin?.dispose()
  })

  it('session/event：user+assistant 消息在一轮结束后提取写入，并可被检索', async () => {
    const fake = makeCtx(extraction)
    const plugin = apply(fake.ctx, { dbPath: ':memory:' })
    expect(plugin).not.toBeNull()

    fake.emit('user/message', { content: '权限模型' })
    fake.emit('assistant/message', { content: '好的' })
    fake.emit('turn/end', { turnId: 't1' })
    await plugin?.flush()

    const section = fake.sections[0]
    const text = typeof section?.text === 'function' ? section.text() : section?.text
    expect(text).toContain('权限模型采用 RBAC')

    const tool = fake.tools[0] as unknown as {
      execute(input: Record<string, unknown>): Promise<{ memories: Array<{ content: string }> }>
    }
    const result = await tool.execute({ query: '权限模型' })
    expect(result.memories.some((m) => m.content.includes('RBAC'))).toBe(true)
    plugin?.dispose()
  })

  it('无 llm 服务时 fail-open：afterTurn 返回 degraded', async () => {
    const plugin = apply(
      { systemPrompt: { section: () => ({}) } },
      { dbPath: ':memory:' },
    )
    const result = await plugin?.adapter.afterTurn({
      sessionId: 's',
      turnId: 't',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result?.degraded).toBe(true)
    plugin?.dispose()
  })
})
