/**
 * 记忆内核的 Port 接口与领域类型。
 * 该包不依赖任何宿主 / 框架，适配器在此基础上实现。
 */

export type Modality = 'asserted' | 'planned' | 'hypothetical' | 'question' | 'quoted'
export type Polarity = 'affirm' | 'negate'
export type SourceSpeaker = 'user' | 'assistant' | 'tool' | 'imported'

export type MemoryStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'INVALID'
  | 'ARCHIVED'
  | 'MERGED'
  | 'TOMBSTONED'

export type DecisionKind =
  | 'NEW_FACT'
  | 'NEW_CONDITION'
  | 'NEW_EXCEPTION'
  | 'CORRECTION'
  | 'PARAPHRASE'
  | 'DUPLICATE'
  | 'NO_GAIN'

/** 写入候选：由适配器从一轮对话中提取 */
export interface MemoryCandidate {
  tenantId?: string
  topicId: string
  entity: string
  attribute: string
  value: string
  /** 人类可读的完整表述（用于 FTS 与注入） */
  content?: string
  conditions?: Record<string, string>
  exceptions?: string[]
  modality?: Modality
  polarity?: Polarity
  sourceSpeaker?: SourceSpeaker
  sourceRefs?: string[]
  confidence?: number
  importance?: number
  /** 写入意图：correct = 用户显式纠正（旧值取代）；assert = 普通陈述（可能形成冲突） */
  intent?: 'assert' | 'correct'
}

export interface MemoryRecord {
  id: string
  tenantId: string
  topicId: string
  entity: string
  attribute: string
  value: string
  /** JSON 文本 */
  conditions: string
  /** JSON 文本 */
  exceptions: string
  factKey: string
  valueHash: string
  contextHash: string
  modality: Modality
  polarity: Polarity
  sourceSpeaker: SourceSpeaker
  /** JSON 文本：来源引用 */
  sourceRefs: string
  content: string
  confidence: number
  importance: number
  hotness: number
  status: MemoryStatus
  createdAt: string
  updatedAt: string
  supersededBy: string | null
  deletedAt: string | null
  tombstoneHash: string | null
}

export interface MemoryDecision {
  decisionId: string
  memoryId: string
  topicId: string
  factKey: string
  decision: DecisionKind
  noveltyScore: number
  coveredBy: string
  judge: 'rule' | 'model'
  judgeVersion: string
  reason: string
  createdAt: string
}

/** 摘要已表达的事实槽位 */
export interface SummaryFact {
  factKey: string
  valueHash: string
}

export interface PendingEntry {
  topicId: string
  factKey: string
  memoryId: string
  noveltyScore: number
}

export type SummaryStatus = 'DRAFT' | 'VALIDATED' | 'ACTIVE' | 'STALE' | 'SUPERSEDED' | 'DISCARDED'

export interface SummaryRecord {
  summaryId: string
  tenantId: string
  topicId: string
  content: string
  version: number
  status: SummaryStatus
  generationDepth: number
  sourceMemoryIds: string[]
  pendingMemoryIds: string[]
  summarizedThrough: string | null
  compressionMetrics: string
  createdAt: string
  updatedAt: string
}

export interface StoragePort {
  /** 单写者事务；失败回滚 */
  tx<T>(fn: () => T): T
  insertMemory(record: MemoryRecord): void
  updateMemoryStatus(id: string, status: MemoryStatus, extra?: Partial<MemoryRecord>): void
  getMemory(id: string): MemoryRecord | null
  findActiveByFactKey(topicId: string, factKey: string): MemoryRecord[]
  findExact(topicId: string, factKey: string, valueHash: string, contextHash: string): MemoryRecord | null
  listActiveByTopic(topicId: string): MemoryRecord[]
  /** 关键词召回（FTS；短词回退 LIKE） */
  search(query: string, opts?: { topicId?: string; limit?: number }): MemoryRecord[]
  insertDecision(decision: MemoryDecision): void
  upsertPending(entry: PendingEntry): void
  pendingNovelty(topicId: string): number
  pendingMemoryIds(topicId: string): string[]
  clearPending(topicId: string, memoryIds: string[]): void

  insertSummary(record: SummaryRecord): void
  getSummary(summaryId: string): SummaryRecord | null
  getActiveSummary(topicId: string): SummaryRecord | null
  updateSummaryStatus(summaryId: string, status: SummaryStatus): void
  /** CAS 激活：仅当仍为 DRAFT 且版本匹配；成功则旧 ACTIVE 置 SUPERSEDED */
  activateSummary(summaryId: string, expectedVersion: number): boolean
  markSummaryStale(topicId: string): void

  createConflictGroup(group: ConflictGroup): void
  getConflictGroup(groupId: string): ConflictGroup | null
  listConflictsByTopic(topicId: string): ConflictGroup[]
  setConflictWinner(groupId: string, winnerMemoryId: string | null, policy: ConflictPolicy, reason: string): void
}

export interface LLMRequest {
  prompt: string
  /** 期望的 JSON Schema 文本（可选） */
  jsonSchema?: string
  timeoutMs?: number
}

export interface LLMPort {
  complete<T = string>(req: LLMRequest): Promise<T>
}

export interface ClockPort {
  now(): Date
}

export interface AuditEntry {
  actor: string
  action: string
  targetType: string
  targetId: string
  detail?: string
  createdAt: string
}

export interface AuditPort {
  append(entry: AuditEntry): Promise<void>
}

export type ConflictPolicy = 'TEMPORAL' | 'SOURCE_PRIORITY' | 'CONFIDENCE' | 'LATEST' | 'UNRESOLVED'

export interface ConflictGroup {
  groupId: string
  tenantId: string
  topicId: string
  factKey: string
  memberMemoryIds: string[]
  winnerMemoryId: string | null
  policy: ConflictPolicy
  decidedAt: string | null
  reason: string
}

/** 注入主上下文的记忆上下文 */
export interface MemoryContext {
  topicId: string | null
  memories: Array<{
    memoryId: string
    content: string
    modality: Modality
    importance: number
    sourceRefs: string[]
  }>
  conflicts: Array<{
    groupId: string
    factKey: string
    memberMemoryIds: string[]
    winnerMemoryId: string | null
    status: 'RESOLVED' | 'UNRESOLVED'
    reason: string
  }>
  tokensUsed: number
  degraded: boolean
}
