import type {
  ConflictGroup,
  MemoryDecision,
  MemoryRecord,
  StoragePort,
  SummaryRecord,
} from '@dsh-memory/ports'

export const EXPORT_SCHEMA_VERSION = 1

export type ExportType = 'memory' | 'summary' | 'conflict' | 'decision'

export interface ExportLine {
  schema_version: number
  type: ExportType
  data: unknown
}

export interface ImportReport {
  imported: Record<ExportType, number>
  skipped: number
  errors: string[]
}

/** 导出为 NDJSON（一行一条记录，§20.7） */
export function exportNdjson(storage: StoragePort, tenantId = 'default'): string {
  const lines: string[] = []
  const push = (type: ExportType, data: unknown) => {
    lines.push(JSON.stringify({ schema_version: EXPORT_SCHEMA_VERSION, type, data } satisfies ExportLine))
  }
  for (const memory of storage.listMemories(tenantId)) push('memory', memory)
  for (const summary of storage.listSummaries(tenantId)) push('summary', summary)
  for (const conflict of storage.listConflicts(tenantId)) push('conflict', conflict)
  for (const decision of storage.listDecisions()) push('decision', decision)
  return lines.join('\n')
}

function isLine(value: unknown): value is ExportLine {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.type === 'string' && record.schema_version === EXPORT_SCHEMA_VERSION && 'data' in record
}

/** 导入 NDJSON；merge 幂等（重复记录跳过），replace 先清空当前租户 */
export function importNdjson(
  storage: StoragePort,
  ndjson: string,
  options: { mode: 'merge' | 'replace'; tenantId?: string } = { mode: 'merge' },
): ImportReport {
  const tenantId = options.tenantId ?? 'default'
  const report: ImportReport = {
    imported: { memory: 0, summary: 0, conflict: 0, decision: 0 },
    skipped: 0,
    errors: [],
  }

  const rows: ExportLine[] = []
  for (const raw of ndjson.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (!isLine(parsed)) {
        report.skipped++
        report.errors.push('invalid line shape')
        continue
      }
      rows.push(parsed)
    } catch {
      report.skipped++
      report.errors.push('invalid json line')
    }
  }

  storage.tx(() => {
    if (options.mode === 'replace') storage.clearAll(tenantId)
    for (const row of rows) {
      try {
        switch (row.type) {
          case 'memory':
            storage.insertMemory(row.data as MemoryRecord)
            break
          case 'summary':
            storage.insertSummary(row.data as SummaryRecord)
            break
          case 'conflict':
            storage.createConflictGroup(row.data as ConflictGroup)
            break
          case 'decision':
            storage.insertDecision(row.data as MemoryDecision)
            break
        }
        report.imported[row.type]++
      } catch {
        // 唯一约束冲突等：merge 模式下视为已存在
        report.skipped++
      }
    }
  })

  return report
}
