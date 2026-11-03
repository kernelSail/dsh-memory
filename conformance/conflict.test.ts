import { describe, expect, it } from 'vitest'
import { createStorage } from '@dsh-memory/storage-sqlite'
import { ingestCandidate, retrieve } from '@dsh-memory/core'
import type { MemoryCandidate } from '@dsh-memory/ports'

const clock = { now: () => new Date('2026-11-03T00:00:00.000Z') }

describe('契约：冲突组与成组注入', () => {
  it('用户陈述 vs 工具观察 → 建组并按来源优先级裁决', () => {
    const storage = createStorage()
    const deps = { storage, clock }

    const userMemory = ingestCandidate(
      { topicId: 't1', entity: 'perm_model', attribute: 'type', value: 'rbac', content: '权限模型采用 RBAC', sourceSpeaker: 'user' },
      deps,
    )
    const toolMemory = ingestCandidate(
      { topicId: 't1', entity: 'perm_model', attribute: 'type', value: 'abac', content: '配置里看到的权限模型是 ABAC', sourceSpeaker: 'tool', intent: 'assert' },
      deps,
    )

    expect(toolMemory.decision).toBe('CORRECTION')
    const groups = storage.listConflictsByTopic('t1')
    expect(groups).toHaveLength(1)
    expect(groups[0]?.policy).toBe('SOURCE_PRIORITY')
    expect(groups[0]?.winnerMemoryId).toBe(userMemory.memoryId)
    expect(groups[0]?.memberMemoryIds).toHaveLength(2)

    // 双方都保留为 ACTIVE（不互相覆盖）
    expect(storage.getMemory(userMemory.memoryId as string)?.status).toBe('ACTIVE')
    expect(storage.getMemory(toolMemory.memoryId as string)?.status).toBe('ACTIVE')

    const context = retrieve(storage, { query: '权限模型', topicId: 't1' })
    expect(context.conflicts).toHaveLength(1)
    expect(context.conflicts[0]?.status).toBe('RESOLVED')
    expect(context.conflicts[0]?.winnerMemoryId).toBe(userMemory.memoryId)
    storage.close()
  })

  it('未消解冲突：成组注入（不允许只出现一条）', () => {
    const storage = createStorage()
    const deps = { storage, clock }

    ingestCandidate(
      { topicId: 't2', entity: 'deploy_mode', attribute: 'cloud', value: 'private', content: '部署模式为私有云', sourceSpeaker: 'assistant' },
      deps,
    )
    ingestCandidate(
      { topicId: 't2', entity: 'deploy_mode', attribute: 'cloud', value: 'public', content: '部署模式为公有云', sourceSpeaker: 'assistant' },
      deps,
    )

    const groups = storage.listConflictsByTopic('t2')
    expect(groups).toHaveLength(1)
    expect(groups[0]?.policy).toBe('UNRESOLVED')

    const context = retrieve(storage, { query: '部署模式', topicId: 't2' })
    expect(context.conflicts[0]?.status).toBe('UNRESOLVED')
    // 组内两条都被注入
    expect(context.memories.length).toBe(2)
    storage.close()
  })
})
