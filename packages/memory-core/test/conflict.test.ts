import { describe, expect, it } from 'vitest'
import type { MemoryRecord, SourceSpeaker } from '@dsh-memory/ports'
import { resolveConflict } from '../src/conflict.js'

function record(overrides: Partial<MemoryRecord> & { sourceSpeaker?: SourceSpeaker } = {}): MemoryRecord {
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
    contextHash: 'ch',
    modality: 'asserted',
    polarity: 'affirm',
    sourceSpeaker: 'user',
    sourceRefs: '[]',
    content: '权限模型采用 RBAC',
    confidence: 0.6,
    importance: 0.5,
    hotness: 0,
    status: 'ACTIVE',
    createdAt: '2026-11-03T00:00:00.000Z',
    updatedAt: '2026-11-03T00:00:00.000Z',
    supersededBy: null,
    deletedAt: null,
    tombstoneHash: null,
    validFrom: null,
    validUntil: null,
    ...overrides,
  }
}

describe('resolveConflict：5 级裁决策略', () => {
  it('来源优先级：用户 > 工具', () => {
    const user = record({ id: 'u' })
    const tool = record({ id: 't', sourceSpeaker: 'tool', value: 'abac', valueHash: 'vh_abac' })
    const r = resolveConflict([user, tool])
    expect(r.policy).toBe('SOURCE_PRIORITY')
    expect(r.winnerMemoryId).toBe('u')
  })

  it('同来源比置信度（差 ≥ 0.2）', () => {
    const high = record({ id: 'h', sourceSpeaker: 'tool', confidence: 0.9 })
    const low = record({ id: 'l', sourceSpeaker: 'tool', confidence: 0.5 })
    const r = resolveConflict([high, low])
    expect(r.policy).toBe('CONFIDENCE')
    expect(r.winnerMemoryId).toBe('h')
  })

  it('同来源同置信度比新近', () => {
    const old = record({ id: 'old', sourceSpeaker: 'tool', updatedAt: '2026-01-01T00:00:00.000Z' })
    const fresh = record({ id: 'new', sourceSpeaker: 'tool', updatedAt: '2026-11-01T00:00:00.000Z' })
    const r = resolveConflict([old, fresh])
    expect(r.policy).toBe('LATEST')
    expect(r.winnerMemoryId).toBe('new')
  })

  it('完全无法区分 → UNRESOLVED', () => {
    const r = resolveConflict([
      record({ id: 'a', sourceSpeaker: 'assistant' }),
      record({ id: 'b', sourceSpeaker: 'assistant' }),
    ])
    expect(r.policy).toBe('UNRESOLVED')
    expect(r.winnerMemoryId).toBeNull()
  })

  it('TEMPORAL：参考时间点仅一条有效', () => {
    const old = record({
      id: 'old',
      sourceSpeaker: 'tool',
      validFrom: '2025-01-01T00:00:00.000Z',
      validUntil: '2025-12-31T23:59:59.000Z',
    })
    const current = record({ id: 'current', sourceSpeaker: 'tool', validFrom: '2026-01-01T00:00:00.000Z' })
    const r = resolveConflict([old, current], new Date('2026-06-01T00:00:00.000Z'))
    expect(r.policy).toBe('TEMPORAL')
    expect(r.winnerMemoryId).toBe('current')
  })

  it('单成员直接胜出', () => {
    const r = resolveConflict([record({ id: 'only' })])
    expect(r.winnerMemoryId).toBe('only')
  })
})
