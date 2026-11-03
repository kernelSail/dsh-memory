import type { AuditPort, ClockPort, StoragePort } from '@dsh-memory/ports'
import { shortHash } from './normalize.js'
import { assertTransition } from './state.js'

export interface ForgetDeps {
  storage: StoragePort
  clock: ClockPort
  audit?: AuditPort
}

export interface ForgetOptions {
  actor: string
  reason: string
}

export interface ForgetResult {
  found: boolean
  memoryId: string
  topicId?: string
  summaryStale: boolean
  tombstoneHash?: string
}

/**
 * 受控删除（§18）：墓碑 + 摘要 stale 传播 + 审计。
 * 不物理删除内容（purge 留待独立任务，属于 §18.2 后续阶段）。
 */
export async function forgetMemory(
  memoryId: string,
  deps: ForgetDeps,
  options: ForgetOptions,
): Promise<ForgetResult> {
  const memory = deps.storage.getMemory(memoryId)
  if (!memory) {
    return { found: false, memoryId, summaryStale: false }
  }
  if (memory.status === 'TOMBSTONED') {
    return { found: true, memoryId, topicId: memory.topicId, summaryStale: false }
  }

  assertTransition(memory.status, 'TOMBSTONED')
  const now = deps.clock.now().toISOString()
  const tombstoneHash = shortHash(memory.content)

  deps.storage.tx(() => {
    deps.storage.forgetMemory(memoryId, {
      deletedAt: now,
      deletedBy: options.actor,
      deleteReason: options.reason,
      tombstoneHash,
    })
    // 依赖传播：摘要不能继续以确定性口吻表达已删除事实（§18.2）
    deps.storage.markSummaryStale(memory.topicId)
  })

  await deps.audit?.append({
    actor: options.actor,
    action: 'forget',
    targetType: 'memory',
    targetId: memoryId,
    detail: JSON.stringify({ reason: options.reason, tombstoneHash }),
    createdAt: now,
  })

  return { found: true, memoryId, topicId: memory.topicId, summaryStale: true, tombstoneHash }
}
