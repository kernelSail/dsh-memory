import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '@dsh-memory/ports'
import { decide } from '../src/decide.js'

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
    sourceRefs: '[]',
    content: '权限模型采用 RBAC',
    confidence: 0.8,
    importance: 0.5,
    hotness: 0,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    supersededBy: null,
    deletedAt: null,
    tombstoneHash: null,
    validFrom: null,
    validUntil: null,
    ...overrides,
  }
}

const baseInput = {
  factKey: 'fk_perm',
  valueHash: 'vh_rbac',
  contextHash: 'ch_base',
  value: 'rbac',
  hasConditions: false,
  hasExceptions: false,
  activeSameFactKey: [] as MemoryRecord[],
  summaryFacts: [] as Array<{ factKey: string; valueHash: string }>,
}

describe('decide: 规则判定', () => {
  it('新槽位 → NEW_FACT 1.0', () => {
    const r = decide(baseInput)
    expect(r.decision).toBe('NEW_FACT')
    expect(r.noveltyScore).toBe(1.0)
    expect(r.needsModel).toBe(false)
  })

  it('摘要已表达同值 → PARAPHRASE 0.2', () => {
    const r = decide({ ...baseInput, summaryFacts: [{ factKey: 'fk_perm', valueHash: 'vh_rbac' }] })
    expect(r.decision).toBe('PARAPHRASE')
    expect(r.noveltyScore).toBe(0.2)
  })

  it('摘要同槽位不同值 → CORRECTION 且需二级确认', () => {
    const r = decide({ ...baseInput, summaryFacts: [{ factKey: 'fk_perm', valueHash: 'vh_abac' }] })
    expect(r.decision).toBe('CORRECTION')
    expect(r.needsModel).toBe(true)
  })

  it('完全重复 → DUPLICATE 0', () => {
    const r = decide({ ...baseInput, activeSameFactKey: [record()] })
    expect(r.decision).toBe('DUPLICATE')
    expect(r.noveltyScore).toBe(0)
  })

  it('同值新增条件 → NEW_CONDITION 0.8', () => {
    const r = decide({
      ...baseInput,
      hasConditions: true,
      activeSameFactKey: [record({ contextHash: 'ch_cond' })],
      contextHash: 'ch_new',
    })
    expect(r.decision).toBe('NEW_CONDITION')
    expect(r.noveltyScore).toBe(0.8)
  })

  it('同值新增例外 → NEW_EXCEPTION 0.8', () => {
    const r = decide({
      ...baseInput,
      hasExceptions: true,
      activeSameFactKey: [record({ contextHash: 'ch_exc' })],
      contextHash: 'ch_new',
    })
    expect(r.decision).toBe('NEW_EXCEPTION')
  })

  it('同上下文值改变 → CORRECTION 0.9 且需二级确认', () => {
    const r = decide({
      ...baseInput,
      value: 'abac',
      valueHash: 'vh_abac',
      activeSameFactKey: [record()],
    })
    expect(r.decision).toBe('CORRECTION')
    expect(r.noveltyScore).toBe(0.9)
    expect(r.needsModel).toBe(true)
  })

  it('空值 → NO_GAIN', () => {
    const r = decide({ ...baseInput, value: '   ' })
    expect(r.decision).toBe('NO_GAIN')
    expect(r.noveltyScore).toBe(0)
  })
})
