import type { MemoryStatus } from '@dsh-memory/ports'

const ALLOWED: Record<MemoryStatus, MemoryStatus[]> = {
  PENDING: ['ACTIVE', 'MERGED', 'TOMBSTONED'],
  ACTIVE: ['SUPERSEDED', 'INVALID', 'ARCHIVED', 'TOMBSTONED'],
  ARCHIVED: ['ACTIVE', 'TOMBSTONED'],
  SUPERSEDED: ['TOMBSTONED'],
  INVALID: ['TOMBSTONED'],
  MERGED: ['TOMBSTONED'],
  TOMBSTONED: [],
}

export function canTransition(from: MemoryStatus, to: MemoryStatus): boolean {
  return ALLOWED[from].includes(to)
}

export function assertTransition(from: MemoryStatus, to: MemoryStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal memory status transition: ${from} -> ${to}`)
  }
}

/** §19.6 非法迁移清单（测试与运行时守卫共用） */
export const ILLEGAL_TRANSITIONS: Array<[MemoryStatus, MemoryStatus]> = [
  ['PENDING', 'ARCHIVED'],
  ['ARCHIVED', 'PENDING'],
  ['SUPERSEDED', 'ACTIVE'],
  ['INVALID', 'ACTIVE'],
  ['TOMBSTONED', 'ACTIVE'],
  ['MERGED', 'ACTIVE'],
  ['INVALID', 'PENDING'],
  ['SUPERSEDED', 'PENDING'],
]
