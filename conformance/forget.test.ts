import { describe, expect, it } from 'vitest'
import { createStorage } from '@dsh-memory/storage-sqlite'
import { forgetMemory, ingestCandidate, retrieve, runSummary } from '@dsh-memory/core'
import type { LLMPort } from '@dsh-memory/ports'

const clock = { now: () => new Date('2026-11-03T00:00:00.000Z') }
const llm: LLMPort = {
  async complete<T>() {
    return { summary: '项目采用 RBAC；用户可加入多个组织；优先单企业私有部署。' } as T
  },
}

describe('契约：受控删除（墓碑）', () => {
  it('删除后不可检索、摘要 STALE、保留 tombstone_hash', async () => {
    const storage = createStorage()
    const deps = { storage, clock }

    const rbac = ingestCandidate(
      { topicId: 't1', entity: 'perm_model', attribute: 'type', value: 'rbac', content: '权限模型采用 RBAC' },
      deps,
    )
    ingestCandidate({ topicId: 't1', entity: 'user_org', attribute: 'membership', value: 'multi', content: '用户可加入多个组织' }, deps)
    ingestCandidate({ topicId: 't1', entity: 'deploy', attribute: 'mode', value: 'private', content: '优先单企业私有部署' }, deps)

    const summary = await runSummary('t1', { storage, clock, llm })
    expect(summary.status).toBe('ACTIVE')
    const active = storage.getActiveSummary('t1')
    expect(active).not.toBeNull()

    const result = await forgetMemory(rbac.memoryId as string, deps, { actor: 'user', reason: '用户要求遗忘' })
    expect(result.found).toBe(true)
    expect(result.summaryStale).toBe(true)
    expect(result.tombstoneHash).toBeTruthy()

    const tombstoned = storage.getMemory(rbac.memoryId as string)
    expect(tombstoned?.status).toBe('TOMBSTONED')
    expect(tombstoned?.deletedAt).toBe('2026-11-03T00:00:00.000Z')
    expect(tombstoned?.tombstoneHash).toBe(result.tombstoneHash)

    // 检索与 FTS 都不再返回
    expect(storage.search('RBAC')).toHaveLength(0)
    const context = retrieve(storage, { query: 'RBAC', topicId: 't1' })
    expect(context.memories.some((m) => m.content.includes('RBAC'))).toBe(false)

    // 摘要依赖被传播为 STALE
    expect(active ? storage.getSummary(active.summaryId)?.status : null).toBe('STALE')
    storage.close()
  })

  it('删除不存在的记忆返回 found=false', async () => {
    const storage = createStorage()
    const result = await forgetMemory('missing', { storage, clock }, { actor: 'user', reason: 'x' })
    expect(result.found).toBe(false)
    storage.close()
  })
})
