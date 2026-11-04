import { describe, expect, it } from 'vitest'
import { createStorage } from '@dsh-memory/storage-sqlite'
import { ingestCandidate, retrieve } from '@dsh-memory/core'

const clock = { now: () => new Date('2026-11-04T00:00:00.000Z') }

describe('契约：主题分类后的检索与 TEMPORAL', () => {
  it('记忆落在其他主题时，指定主题检索会跨主题回退', () => {
    const storage = createStorage()
    ingestCandidate(
      { topicId: 'alpha', entity: 'perm_model', attribute: 'type', value: 'rbac', content: '项目权限模型是 RBAC' },
      { storage, clock },
    )
    const context = retrieve(storage, { query: '权限模型', topicId: 'beta' })
    expect(context.memories.some((m) => m.content.includes('RBAC'))).toBe(true)
    storage.close()
  })

  it('TEMPORAL：时间窗不重叠时按参考时间裁决', () => {
    const storage = createStorage()
    const deps = { storage, clock }
    ingestCandidate(
      {
        topicId: 't1',
        entity: 'perm_model',
        attribute: 'type',
        value: 'rbac',
        content: '2025 年权限模型是 RBAC',
        sourceSpeaker: 'tool',
        validFrom: '2025-01-01T00:00:00.000Z',
        validUntil: '2025-12-31T23:59:59.000Z',
      },
      deps,
    )
    ingestCandidate(
      {
        topicId: 't1',
        entity: 'perm_model',
        attribute: 'type',
        value: 'abac',
        content: '2026 年起权限模型是 ABAC',
        sourceSpeaker: 'tool',
        validFrom: '2026-01-01T00:00:00.000Z',
        intent: 'assert',
      },
      deps,
    )
    const groups = storage.listConflictsByTopic('t1')
    expect(groups).toHaveLength(1)
    expect(groups[0]?.policy).toBe('TEMPORAL')
    expect(groups[0]?.winnerMemoryId).toBeTruthy()
    storage.close()
  })
})
