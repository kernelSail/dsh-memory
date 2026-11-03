import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '@dsh-memory/ports'
import { createStorage } from '../src/index.js'

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'm1',
    tenantId: 'default',
    topicId: 't1',
    entity: 'perm_model',
    attribute: 'type',
    value: 'rbac',
    conditions: '{}',
    exceptions: '[]',
    factKey: 'fk_perm',
    valueHash: 'vh_rbac',
    contextHash: 'ch_base',
    modality: 'asserted',
    polarity: 'affirm',
    sourceSpeaker: 'user',
    sourceRefs: '["turn-1"]',
    content: '权限模型采用 RBAC，用户可加入多个组织',
    confidence: 0.8,
    importance: 0.6,
    hotness: 0,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    supersededBy: null,
    deletedAt: null,
    tombstoneHash: null,
    ...overrides,
  }
}

describe('SqliteStorage', () => {
  it('插入 / 读取 / 精确查找', () => {
    const storage = createStorage()
    storage.insertMemory(record())
    expect(storage.getMemory('m1')?.value).toBe('rbac')
    expect(storage.findExact('t1', 'fk_perm', 'vh_rbac', 'ch_base')?.id).toBe('m1')
    storage.close()
  })

  it('唯一索引阻止同事实同上下文重复', () => {
    const storage = createStorage()
    storage.insertMemory(record())
    expect(() => storage.insertMemory(record({ id: 'm2' }))).toThrow()
    storage.close()
  })

  it('同事实不同上下文可并存（新条件）', () => {
    const storage = createStorage()
    storage.insertMemory(record())
    storage.insertMemory(record({ id: 'm2', contextHash: 'ch_cond' }))
    expect(storage.findActiveByFactKey('t1', 'fk_perm')).toHaveLength(2)
    storage.close()
  })

  it('中文 FTS 检索（≥3 字）与短词 LIKE 回退', () => {
    const storage = createStorage()
    storage.insertMemory(record())
    expect(storage.search('权限模型').length).toBe(1)
    expect(storage.search('权限').length).toBe(1)
    expect(storage.search('不存在的词').length).toBe(0)
    storage.close()
  })

  it('事务回滚不留下半成品', () => {
    const storage = createStorage()
    expect(() =>
      storage.tx(() => {
        storage.insertMemory(record({ id: 'm_tx' }))
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(storage.getMemory('m_tx')).toBeNull()
    storage.close()
  })

  it('pending 累计：同 fact_key 取最大值', () => {
    const storage = createStorage()
    storage.upsertPending({ topicId: 't1', factKey: 'fk_perm', memoryId: 'm1', noveltyScore: 1.0 })
    storage.upsertPending({ topicId: 't1', factKey: 'fk_perm', memoryId: 'm2', noveltyScore: 0.2 })
    storage.upsertPending({ topicId: 't1', factKey: 'fk_org', memoryId: 'm3', noveltyScore: 0.8 })
    expect(storage.pendingNovelty('t1')).toBeCloseTo(1.8, 5)
    expect(storage.pendingMemoryIds('t1')).toHaveLength(2)
    storage.close()
  })
})
