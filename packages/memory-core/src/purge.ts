import type { AuditPort, ClockPort, StoragePort } from '@dsh-memory/ports'

export interface PurgeDeps {
  storage: StoragePort
  clock: ClockPort
  audit?: AuditPort
}

export interface PurgeResult {
  purged: boolean
  reason: string
}

/**
 * 硬删内容（§18.2 最后一步）：仅允许对已 forget（deleted_at 非空）的记录执行。
 * 保留 tombstone_hash 与审计，内容不可恢复。
 */
export async function purgeMemory(
  memoryId: string,
  deps: PurgeDeps,
  options: { actor: string; reason: string },
): Promise<PurgeResult> {
  const memory = deps.storage.getMemory(memoryId)
  if (!memory) return { purged: false, reason: 'not found' }
  if (!memory.deletedAt) return { purged: false, reason: 'must forget before purge' }

  const now = deps.clock.now().toISOString()
  deps.storage.tx(() => {
    deps.storage.purgeMemory(memoryId, now)
  })

  await deps.audit?.append({
    actor: options.actor,
    action: 'purge',
    targetType: 'memory',
    targetId: memoryId,
    detail: JSON.stringify({ reason: options.reason, tombstoneHash: memory.tombstoneHash }),
    createdAt: now,
  })

  return { purged: true, reason: 'ok' }
}
