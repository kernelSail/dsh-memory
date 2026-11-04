import { describe, expect, it } from 'vitest'
import { createStorage } from '@dsh-memory/storage-sqlite'
import {
  exportNdjson,
  forgetMemory,
  importNdjson,
  ingestCandidate,
  purgeMemory,
  runSummary,
} from '@dsh-memory/core'
import type { LLMPort } from '@dsh-memory/ports'

const clock = { now: () => new Date('2026-11-03T00:00:00.000Z') }
const llm: LLMPort = {
  async complete<T>() {
    return { summary: '项目采用 RBAC；用户可加入多个组织；优先单企业私有部署。' } as T
  },
}

function seed() {
  const storage = createStorage()
  const deps = { storage, clock }
  ingestCandidate({ topicId: 't1', entity: 'perm_model', attribute: 'type', value: 'rbac', content: '权限模型采用 RBAC' }, deps)
  ingestCandidate({ topicId: 't1', entity: 'user_org', attribute: 'membership', value: 'multi', content: '用户可加入多个组织' }, deps)
  ingestCandidate({ topicId: 't1', entity: 'deploy', attribute: 'mode', value: 'private', content: '优先单企业私有部署' }, deps)
  ingestCandidate(
    { topicId: 't1', entity: 'perm_model', attribute: 'type', value: 'abac', content: '配置里是 ABAC', sourceSpeaker: 'tool', intent: 'assert' },
    deps,
  )
  return storage
}

describe('契约：导出 / 导入（NDJSON）', () => {
  it('export → import replace 往返一致', async () => {
    const source = seed()
    await runSummary('t1', { storage: source, clock, llm })

    const ndjson = exportNdjson(source, 'default')
    const lines = ndjson.split('\n').filter(Boolean)
    const types = new Set(lines.map((line) => (JSON.parse(line) as { type: string }).type))
    expect(types.has('memory')).toBe(true)
    expect(types.has('summary')).toBe(true)
    expect(types.has('conflict')).toBe(true)

    const target = createStorage()
    const report = importNdjson(target, ndjson, { mode: 'replace' })
    expect(report.skipped).toBe(0)
    expect(target.listMemories('default')).toHaveLength(4)
    expect(target.listSummaries('default')).toHaveLength(1)
    expect(target.getActiveSummary('t1')?.content).toContain('RBAC')
    expect(target.listConflicts('default')).toHaveLength(1)
    source.close()
    target.close()
  })

  it('merge 导入幂等：重复导入全部跳过', async () => {
    const source = seed()
    const ndjson = exportNdjson(source, 'default')
    const target = createStorage()
    importNdjson(target, ndjson, { mode: 'merge' })
    const second = importNdjson(target, ndjson, { mode: 'merge' })
    expect(second.imported.memory).toBe(0)
    expect(second.skipped).toBeGreaterThan(0)
    expect(target.listMemories('default')).toHaveLength(4)
    source.close()
    target.close()
  })

  it('坏行不影响其余导入', () => {
    const target = createStorage()
    const report = importNdjson(target, 'not-json\n{"schema_version":1,"type":"memory","data":{}}', { mode: 'merge' })
    expect(report.errors.length).toBeGreaterThan(0)
    target.close()
  })
})

describe('契约：purge 硬删', () => {
  it('必须先 forget 才能 purge；purge 后内容清空且保留 tombstone', async () => {
    const storage = createStorage()
    const deps = { storage, clock }
    const memory = ingestCandidate(
      { topicId: 't1', entity: 'secret', attribute: 'value', value: 'x', content: '机密信息' },
      deps,
    )
    const id = memory.memoryId as string

    const early = await purgeMemory(id, deps, { actor: 'user', reason: 'x' })
    expect(early.purged).toBe(false)

    await forgetMemory(id, deps, { actor: 'user', reason: '用户要求遗忘' })
    const result = await purgeMemory(id, deps, { actor: 'user', reason: '合规清除' })
    expect(result.purged).toBe(true)

    const purged = storage.getMemory(id)
    expect(purged?.content).toBe('')
    expect(purged?.tombstoneHash).toBeTruthy()
    expect(storage.search('机密信息')).toHaveLength(0)
    storage.close()
  })
})
