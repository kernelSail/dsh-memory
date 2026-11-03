import { describe, expect, it } from 'vitest'
import { createStorage } from '@dsh-memory/storage-sqlite'
import { ingestCandidate, runSummary } from '@dsh-memory/core'
import type { LLMPort, MemoryCandidate } from '@dsh-memory/ports'

const clock = { now: () => new Date('2026-11-03T00:00:00.000Z') }

function llmReturning(payload: unknown): LLMPort {
  return {
    async complete<T>() {
      return payload as T
    },
  }
}

function addFacts(storage: ReturnType<typeof createStorage>, noveltyThreshold = 3): void {
  const candidates: MemoryCandidate[] = [
    { topicId: 't1', entity: 'perm_model', attribute: 'type', value: 'rbac', content: '权限模型采用 RBAC' },
    { topicId: 't1', entity: 'user_org', attribute: 'membership', value: 'multi', content: '一个用户可以加入多个组织' },
    { topicId: 't1', entity: 'deploy', attribute: 'mode', value: 'private', content: '优先面向单企业私有部署' },
  ]
  for (const candidate of candidates) {
    ingestCandidate(candidate, { storage, clock, noveltyThreshold })
  }
}

describe('契约：增量总结', () => {
  it('达到阈值后生成并激活摘要，清理 pending', async () => {
    const storage = createStorage()
    addFacts(storage)
    expect(storage.pendingNovelty('t1')).toBeCloseTo(3.0, 5)

    const result = await runSummary('t1', {
      storage,
      clock,
      llm: llmReturning({ summary: '项目采用 RBAC；用户可加入多个组织；优先单企业私有部署。' }),
    })

    expect(result.ran).toBe(true)
    expect(result.status).toBe('ACTIVE')
    const active = storage.getActiveSummary('t1')
    expect(active?.version).toBe(1)
    expect(active?.status).toBe('ACTIVE')
    expect(active?.content).toContain('RBAC')
    expect(storage.pendingNovelty('t1')).toBe(0)
    storage.close()
  })

  it('校验失败（摘要过短）→ DISCARDED，pending 保留', async () => {
    const storage = createStorage()
    addFacts(storage)

    const result = await runSummary('t1', { storage, clock, llm: llmReturning({ summary: '太短' }) })

    expect(result.ran).toBe(true)
    expect(result.status).toBe('DISCARDED')
    expect(storage.getActiveSummary('t1')).toBeNull()
    expect(storage.pendingNovelty('t1')).toBeCloseTo(3.0, 5)
    storage.close()
  })

  it('LLM 抛错 → DISCARDED，pending 保留', async () => {
    const storage = createStorage()
    addFacts(storage)
    const llm: LLMPort = {
      async complete() {
        throw new Error('timeout')
      },
    }

    const result = await runSummary('t1', { storage, clock, llm })
    expect(result.status).toBe('DISCARDED')
    expect(storage.pendingNovelty('t1')).toBeCloseTo(3.0, 5)
    storage.close()
  })

  it('第二次总结：版本递增，旧摘要 SUPERSEDED', async () => {
    const storage = createStorage()
    addFacts(storage)
    const llm = llmReturning({ summary: '项目采用 RBAC；用户可加入多个组织；优先单企业私有部署。' })
    await runSummary('t1', { storage, clock, llm })
    const first = storage.getActiveSummary('t1')

    ingestCandidate(
      { topicId: 't1', entity: 'perm_model', attribute: 'type', value: 'abac', content: '权限模型改为 ABAC', sourceSpeaker: 'user' },
      { storage, clock, noveltyThreshold: 3 },
    )
    const second = await runSummary('t1', {
      storage,
      clock,
      // 用户修正属于高价值增量，立即总结
      force: true,
      llm: llmReturning({ summary: '项目权限模型已改为 ABAC；用户可加入多个组织；优先单企业私有部署。' }),
    })

    expect(second.status).toBe('ACTIVE')
    const active = storage.getActiveSummary('t1')
    expect(active?.version).toBe(2)
    expect(active?.generationDepth).toBe(2)
    expect(active?.sourceMemoryIds.length).toBeGreaterThan(first?.sourceMemoryIds.length ?? 0)
    expect(first ? storage.getSummary(first.summaryId)?.status : null).toBe('SUPERSEDED')
    storage.close()
  })

  it('未达阈值 → SKIPPED，不调用模型', async () => {
    const storage = createStorage()
    ingestCandidate(
      { topicId: 't2', entity: 'a', attribute: 'b', value: 'c', content: '只有一条记忆' },
      { storage, clock },
    )
    const llm: LLMPort = {
      async complete() {
        throw new Error('should not be called')
      },
    }
    const result = await runSummary('t2', { storage, clock, llm })
    expect(result.ran).toBe(false)
    expect(result.status).toBe('SKIPPED')
    storage.close()
  })
})
