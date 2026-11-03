import { describe, expect, it } from 'vitest'
import { createStorage } from '@dsh-memory/storage-sqlite'
import { ingestCandidate, renderMemoryContext, retrieve } from '@dsh-memory/core'
import type { MemoryCandidate } from '@dsh-memory/ports'

const clock = { now: () => new Date('2026-11-03T00:00:00.000Z') }

const rbac: MemoryCandidate = {
  topicId: 't1',
  entity: 'perm_model',
  attribute: 'type',
  value: 'rbac',
  content: '权限模型采用 RBAC',
  sourceSpeaker: 'user',
  sourceRefs: ['turn-1'],
}

describe('契约：写入 → 增量判定 → pending → 检索', () => {
  it('完整链路', () => {
    const storage = createStorage()
    const deps = { storage, clock, noveltyThreshold: 3 }

    const r1 = ingestCandidate(rbac, deps)
    expect(r1.decision).toBe('NEW_FACT')
    expect(r1.noveltyScore).toBe(1.0)
    expect(r1.pendingNovelty).toBe(1.0)
    expect(r1.summarizeSuggested).toBe(false)

    const r2 = ingestCandidate(rbac, deps)
    expect(r2.decision).toBe('DUPLICATE')
    expect(r2.noveltyScore).toBe(0)
    expect(r2.memoryId).toBeNull()

    const r3 = ingestCandidate(
      { topicId: 't1', entity: 'user_org', attribute: 'membership', value: 'multi', content: '一个用户可以加入多个组织' },
      deps,
    )
    expect(r3.decision).toBe('NEW_FACT')
    expect(r3.pendingNovelty).toBeCloseTo(2.0, 5)

    const r4 = ingestCandidate(
      { topicId: 't1', entity: 'perm_model', attribute: 'type', value: 'abac', content: '权限模型改为 ABAC', sourceSpeaker: 'user' },
      deps,
    )
    expect(r4.decision).toBe('CORRECTION')
    expect(r4.needsModel).toBe(true)
    // pending 按 fact_key 取最大值：perm 槽位仍为 1.0，org 槽位 1.0 → 2.0
    expect(r4.pendingNovelty).toBeCloseTo(2.0, 5)
    // 修正属于高价值增量，立即触发总结候选
    expect(r4.summarizeSuggested).toBe(true)

    // 修正后旧事实被取代，检索只应看到 ABAC
    expect(storage.getMemory(r1.memoryId as string)?.status).toBe('SUPERSEDED')

    const context = retrieve(storage, { query: '权限模型', topicId: 't1' })
    const contents = context.memories.map((m) => m.content).join('|')
    expect(contents).toContain('ABAC')
    expect(renderMemoryContext(context)).toContain('[记忆上下文]')

    const r5 = ingestCandidate(
      { topicId: 't1', entity: 'deploy', attribute: 'mode', value: 'private', content: '优先面向单企业私有部署' },
      deps,
    )
    expect(r5.summarizeSuggested).toBe(true)

    storage.close()
  })
})
