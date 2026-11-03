import { DatabaseSync } from 'node:sqlite'
import type {
  ConflictGroup,
  ConflictPolicy,
  MemoryDecision,
  MemoryRecord,
  MemoryStatus,
  PendingEntry,
  StoragePort,
  SummaryRecord,
  SummaryStatus,
} from '@dsh-memory/ports'

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS memory (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL DEFAULT 'default',
    topic_id      TEXT NOT NULL,
    entity        TEXT NOT NULL,
    attribute     TEXT NOT NULL,
    value         TEXT NOT NULL,
    conditions    TEXT NOT NULL DEFAULT '{}',
    exceptions    TEXT NOT NULL DEFAULT '[]',
    fact_key      TEXT NOT NULL,
    value_hash    TEXT NOT NULL,
    context_hash  TEXT NOT NULL DEFAULT '',
    modality      TEXT NOT NULL DEFAULT 'asserted',
    polarity      TEXT NOT NULL DEFAULT 'affirm',
    source_speaker TEXT NOT NULL DEFAULT 'user',
    source_refs   TEXT NOT NULL DEFAULT '[]',
    content       TEXT NOT NULL,
    confidence    REAL NOT NULL DEFAULT 0.5,
    importance    REAL NOT NULL DEFAULT 0.5,
    hotness       REAL NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'PENDING',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    superseded_by TEXT,
    deleted_at    TEXT,
    tombstone_hash TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_memory_fact
    ON memory(tenant_id, topic_id, fact_key, value_hash, context_hash)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS ix_memory_topic_status ON memory(topic_id, status);
  CREATE INDEX IF NOT EXISTS ix_memory_fact_key ON memory(topic_id, fact_key);

  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    content,
    content='memory',
    content_rowid='rowid',
    tokenize='trigram'
  );
  CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
    INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  END;
  CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
  END;

  CREATE TABLE IF NOT EXISTS memory_pending (
    topic_id      TEXT NOT NULL,
    fact_key      TEXT NOT NULL,
    memory_id     TEXT NOT NULL,
    novelty_score REAL NOT NULL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (topic_id, fact_key)
  );

  CREATE TABLE IF NOT EXISTS memory_decision (
    decision_id   TEXT PRIMARY KEY,
    memory_id     TEXT NOT NULL,
    topic_id      TEXT NOT NULL,
    fact_key      TEXT NOT NULL,
    decision      TEXT NOT NULL,
    novelty_score REAL NOT NULL,
    covered_by    TEXT NOT NULL DEFAULT '',
    judge         TEXT NOT NULL,
    judge_version TEXT NOT NULL,
    reason        TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS topic_summary (
    summary_id          TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL DEFAULT 'default',
    topic_id            TEXT NOT NULL,
    content             TEXT NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    status              TEXT NOT NULL DEFAULT 'DRAFT',
    generation_depth    INTEGER NOT NULL DEFAULT 1,
    source_memory_ids   TEXT NOT NULL DEFAULT '[]',
    pending_memory_ids  TEXT NOT NULL DEFAULT '[]',
    summarized_through  TEXT,
    compression_metrics TEXT NOT NULL DEFAULT '{}',
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_summary_active
    ON topic_summary(tenant_id, topic_id) WHERE status = 'ACTIVE';
  CREATE INDEX IF NOT EXISTS ix_summary_topic_status ON topic_summary(topic_id, status);
  CREATE TABLE IF NOT EXISTS audit_log (
    audit_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    detail      TEXT,
    created_at  TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS conflict_group (
    conflict_group_id TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL DEFAULT 'default',
    topic_id          TEXT NOT NULL,
    fact_key          TEXT NOT NULL,
    winner_memory_id  TEXT,
    policy            TEXT NOT NULL,
    decided_at        TEXT,
    reason            TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS conflict_member (
    conflict_group_id TEXT NOT NULL REFERENCES conflict_group(conflict_group_id),
    memory_id         TEXT NOT NULL,
    PRIMARY KEY (conflict_group_id, memory_id)
  );
  CREATE INDEX IF NOT EXISTS ix_conflict_topic ON conflict_group(topic_id, fact_key);
  `,
  `
  CREATE TABLE IF NOT EXISTS memory_dependency (
    source_memory_id TEXT NOT NULL,
    dependent_type   TEXT NOT NULL,
    dependent_id     TEXT NOT NULL,
    PRIMARY KEY (source_memory_id, dependent_type, dependent_id)
  );
  CREATE INDEX IF NOT EXISTS ix_dependency_dependent ON memory_dependency(dependent_type, dependent_id);
  `,
  `
  ALTER TABLE memory ADD COLUMN deleted_by TEXT;
  ALTER TABLE memory ADD COLUMN delete_reason TEXT;
  `,
]

export interface OpenOptions {
  path?: string
}

export function openDatabase(options: OpenOptions = {}): DatabaseSync {
  const db = new DatabaseSync(options.path ?? ':memory:')
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const current = row.user_version
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN IMMEDIATE;')
    try {
      db.exec(MIGRATIONS[version] as string)
      db.exec(`PRAGMA user_version = ${version + 1};`)
      db.exec('COMMIT;')
    } catch (error) {
      db.exec('ROLLBACK;')
      throw error
    }
  }
}

function rowToRecord(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    topicId: String(row.topic_id),
    entity: String(row.entity),
    attribute: String(row.attribute),
    value: String(row.value),
    conditions: String(row.conditions),
    exceptions: String(row.exceptions),
    factKey: String(row.fact_key),
    valueHash: String(row.value_hash),
    contextHash: String(row.context_hash),
    modality: row.modality as MemoryRecord['modality'],
    polarity: row.polarity as MemoryRecord['polarity'],
    sourceSpeaker: row.source_speaker as MemoryRecord['sourceSpeaker'],
    sourceRefs: String(row.source_refs),
    content: String(row.content),
    confidence: Number(row.confidence),
    importance: Number(row.importance),
    hotness: Number(row.hotness),
    status: row.status as MemoryStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    supersededBy: row.superseded_by === null ? null : String(row.superseded_by),
    deletedAt: row.deleted_at === null ? null : String(row.deleted_at),
    tombstoneHash: row.tombstone_hash === null ? null : String(row.tombstone_hash),
  }
}

function rowToSummary(row: Record<string, unknown>): SummaryRecord {
  return {
    summaryId: String(row.summary_id),
    tenantId: String(row.tenant_id),
    topicId: String(row.topic_id),
    content: String(row.content),
    version: Number(row.version),
    status: row.status as SummaryStatus,
    generationDepth: Number(row.generation_depth),
    sourceMemoryIds: JSON.parse(String(row.source_memory_ids)) as string[],
    pendingMemoryIds: JSON.parse(String(row.pending_memory_ids)) as string[],
    summarizedThrough: row.summarized_through === null ? null : String(row.summarized_through),
    compressionMetrics: String(row.compression_metrics),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

const COLUMNS = [
  'id', 'tenant_id', 'topic_id', 'entity', 'attribute', 'value', 'conditions', 'exceptions',
  'fact_key', 'value_hash', 'context_hash', 'modality', 'polarity', 'source_speaker',
  'source_refs', 'content', 'confidence', 'importance', 'hotness', 'status', 'created_at',
  'updated_at', 'superseded_by', 'deleted_at', 'tombstone_hash',
]

export class SqliteStorage implements StoragePort {
  private depth = 0

  constructor(private readonly db: DatabaseSync) {}

  tx<T>(fn: () => T): T {
    const outermost = this.depth === 0
    if (outermost) this.db.exec('BEGIN IMMEDIATE;')
    this.depth++
    try {
      const result = fn()
      this.depth--
      if (outermost) this.db.exec('COMMIT;')
      return result
    } catch (error) {
      this.depth--
      if (outermost) this.db.exec('ROLLBACK;')
      throw error
    }
  }

  insertMemory(record: MemoryRecord): void {
    const placeholders = COLUMNS.map(() => '?').join(', ')
    const values = COLUMNS.map((column) => {
      switch (column) {
        case 'id': return record.id
        case 'tenant_id': return record.tenantId
        case 'topic_id': return record.topicId
        case 'entity': return record.entity
        case 'attribute': return record.attribute
        case 'value': return record.value
        case 'conditions': return record.conditions
        case 'exceptions': return record.exceptions
        case 'fact_key': return record.factKey
        case 'value_hash': return record.valueHash
        case 'context_hash': return record.contextHash
        case 'modality': return record.modality
        case 'polarity': return record.polarity
        case 'source_speaker': return record.sourceSpeaker
        case 'source_refs': return record.sourceRefs
        case 'content': return record.content
        case 'confidence': return record.confidence
        case 'importance': return record.importance
        case 'hotness': return record.hotness
        case 'status': return record.status
        case 'created_at': return record.createdAt
        case 'updated_at': return record.updatedAt
        case 'superseded_by': return record.supersededBy
        case 'deleted_at': return record.deletedAt
        case 'tombstone_hash': return record.tombstoneHash
        default: throw new Error(`unknown column ${column}`)
      }
    })
    this.db.prepare(`INSERT INTO memory (${COLUMNS.join(', ')}) VALUES (${placeholders})`).run(...values)
  }

  updateMemoryStatus(id: string, status: MemoryStatus, extra?: Partial<MemoryRecord>): void {
    const sets = ['status = ?', 'updated_at = ?']
    const params: Array<string | number | null> = [status, extra?.updatedAt ?? new Date().toISOString()]
    if (extra?.supersededBy !== undefined) {
      sets.push('superseded_by = ?')
      params.push(extra.supersededBy)
    }
    params.push(id)
    this.db.prepare(`UPDATE memory SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  getMemory(id: string): MemoryRecord | null {
    const row = this.db.prepare('SELECT * FROM memory WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? rowToRecord(row) : null
  }

  findActiveByFactKey(topicId: string, factKey: string): MemoryRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM memory WHERE topic_id = ? AND fact_key = ? AND status = 'ACTIVE' AND deleted_at IS NULL")
      .all(topicId, factKey) as Array<Record<string, unknown>>
    return rows.map(rowToRecord)
  }

  findExact(topicId: string, factKey: string, valueHash: string, contextHash: string): MemoryRecord | null {
    const row = this.db
      .prepare(
        "SELECT * FROM memory WHERE topic_id = ? AND fact_key = ? AND value_hash = ? AND context_hash = ?"
          + " AND deleted_at IS NULL LIMIT 1",
      )
      .get(topicId, factKey, valueHash, contextHash) as Record<string, unknown> | undefined
    return row ? rowToRecord(row) : null
  }

  listActiveByTopic(topicId: string): MemoryRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM memory WHERE topic_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL ORDER BY updated_at DESC")
      .all(topicId) as Array<Record<string, unknown>>
    return rows.map(rowToRecord)
  }

  search(query: string, opts: { topicId?: string; limit?: number } = {}): MemoryRecord[] {
    const limit = opts.limit ?? 50
    const trimmed = query.trim()
    const topicClause = opts.topicId ? ' AND m.topic_id = ?' : ''
    const topicParams = opts.topicId ? [opts.topicId] : []

    if (trimmed.length >= 3) {
      const match = `"${trimmed.replace(/"/g, '""')}"`
      const rows = this.db
        .prepare(
          `SELECT m.* FROM memory m JOIN memory_fts f ON f.rowid = m.rowid
           WHERE memory_fts MATCH ?${topicClause} AND m.deleted_at IS NULL
           ORDER BY m.importance DESC LIMIT ?`,
        )
        .all(match, ...topicParams, limit) as Array<Record<string, unknown>>
      if (rows.length > 0) return rows.map(rowToRecord)
    }

    const like = `%${trimmed}%`
    const rows = this.db
      .prepare(
        `SELECT m.* FROM memory m
         WHERE m.content LIKE ?${topicClause} AND m.deleted_at IS NULL
         ORDER BY m.importance DESC LIMIT ?`,
      )
      .all(like, ...topicParams, limit) as Array<Record<string, unknown>>
    return rows.map(rowToRecord)
  }

  insertDecision(decision: MemoryDecision): void {
    this.db
      .prepare(
        `INSERT INTO memory_decision
         (decision_id, memory_id, topic_id, fact_key, decision, novelty_score, covered_by, judge, judge_version, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        decision.decisionId,
        decision.memoryId,
        decision.topicId,
        decision.factKey,
        decision.decision,
        decision.noveltyScore,
        decision.coveredBy,
        decision.judge,
        decision.judgeVersion,
        decision.reason,
        decision.createdAt,
      )
  }

  upsertPending(entry: PendingEntry): void {
    this.db
      .prepare(
        `INSERT INTO memory_pending (topic_id, fact_key, memory_id, novelty_score, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(topic_id, fact_key) DO UPDATE SET
           memory_id = excluded.memory_id,
           novelty_score = MAX(memory_pending.novelty_score, excluded.novelty_score),
           updated_at = excluded.updated_at`,
      )
      .run(entry.topicId, entry.factKey, entry.memoryId, entry.noveltyScore, new Date().toISOString())
  }

  pendingNovelty(topicId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(novelty_score), 0) AS total FROM memory_pending WHERE topic_id = ?')
      .get(topicId) as { total: number }
    return Number(row.total)
  }

  pendingMemoryIds(topicId: string): string[] {
    const rows = this.db
      .prepare('SELECT memory_id FROM memory_pending WHERE topic_id = ? ORDER BY updated_at')
      .all(topicId) as Array<{ memory_id: string }>
    return rows.map((row) => row.memory_id)
  }

  clearPending(topicId: string, memoryIds: string[]): void {
    if (memoryIds.length === 0) {
      this.db.prepare('DELETE FROM memory_pending WHERE topic_id = ?').run(topicId)
      return
    }
    const placeholders = memoryIds.map(() => '?').join(', ')
    this.db
      .prepare(`DELETE FROM memory_pending WHERE topic_id = ? AND memory_id IN (${placeholders})`)
      .run(topicId, ...memoryIds)
  }

  insertSummary(record: SummaryRecord): void {
    this.db
      .prepare(
        `INSERT INTO topic_summary
         (summary_id, tenant_id, topic_id, content, version, status, generation_depth,
          source_memory_ids, pending_memory_ids, summarized_through, compression_metrics, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.summaryId,
        record.tenantId,
        record.topicId,
        record.content,
        record.version,
        record.status,
        record.generationDepth,
        JSON.stringify(record.sourceMemoryIds),
        JSON.stringify(record.pendingMemoryIds),
        record.summarizedThrough,
        record.compressionMetrics,
        record.createdAt,
        record.updatedAt,
      )
  }

  getSummary(summaryId: string): SummaryRecord | null {
    const row = this.db.prepare('SELECT * FROM topic_summary WHERE summary_id = ?').get(summaryId) as
      | Record<string, unknown>
      | undefined
    return row ? rowToSummary(row) : null
  }

  getActiveSummary(topicId: string): SummaryRecord | null {
    const row = this.db
      .prepare("SELECT * FROM topic_summary WHERE topic_id = ? AND status = 'ACTIVE' LIMIT 1")
      .get(topicId) as Record<string, unknown> | undefined
    return row ? rowToSummary(row) : null
  }

  updateSummaryStatus(summaryId: string, status: SummaryStatus): void {
    this.db
      .prepare('UPDATE topic_summary SET status = ?, updated_at = ? WHERE summary_id = ?')
      .run(status, new Date().toISOString(), summaryId)
  }

  activateSummary(summaryId: string, expectedVersion: number): boolean {
    return this.tx(() => {
      const target = this.getSummary(summaryId)
      if (!target || (target.status !== 'DRAFT' && target.status !== 'VALIDATED') || target.version !== expectedVersion) {
        return false
      }
      const current = this.getActiveSummary(target.topicId)
      if (current) this.updateSummaryStatus(current.summaryId, 'SUPERSEDED')
      const result = this.db
        .prepare(
          "UPDATE topic_summary SET status = 'ACTIVE', updated_at = ? WHERE summary_id = ? AND status IN ('DRAFT','VALIDATED') AND version = ?",
        )
        .run(new Date().toISOString(), summaryId, expectedVersion)
      return Number(result.changes) > 0
    })
  }

  markSummaryStale(topicId: string): void {
    this.db
      .prepare("UPDATE topic_summary SET status = 'STALE', updated_at = ? WHERE topic_id = ? AND status = 'ACTIVE'")
      .run(new Date().toISOString(), topicId)
  }

  createConflictGroup(group: ConflictGroup): void {
    this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO conflict_group
           (conflict_group_id, tenant_id, topic_id, fact_key, winner_memory_id, policy, decided_at, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          group.groupId,
          group.tenantId,
          group.topicId,
          group.factKey,
          group.winnerMemoryId,
          group.policy,
          group.decidedAt,
          group.reason,
        )
      const insertMember = this.db.prepare(
        'INSERT OR IGNORE INTO conflict_member (conflict_group_id, memory_id) VALUES (?, ?)',
      )
      for (const memoryId of group.memberMemoryIds) {
        insertMember.run(group.groupId, memoryId)
      }
    })
  }

  getConflictGroup(groupId: string): ConflictGroup | null {
    const row = this.db
      .prepare('SELECT * FROM conflict_group WHERE conflict_group_id = ?')
      .get(groupId) as Record<string, unknown> | undefined
    if (!row) return null
    const members = this.db
      .prepare('SELECT memory_id FROM conflict_member WHERE conflict_group_id = ?')
      .all(groupId) as Array<{ memory_id: string }>
    return {
      groupId: String(row.conflict_group_id),
      tenantId: String(row.tenant_id),
      topicId: String(row.topic_id),
      factKey: String(row.fact_key),
      memberMemoryIds: members.map((m) => m.memory_id),
      winnerMemoryId: row.winner_memory_id === null ? null : String(row.winner_memory_id),
      policy: row.policy as ConflictPolicy,
      decidedAt: row.decided_at === null ? null : String(row.decided_at),
      reason: String(row.reason),
    }
  }

  listConflictsByTopic(topicId: string): ConflictGroup[] {
    const rows = this.db
      .prepare('SELECT conflict_group_id FROM conflict_group WHERE topic_id = ?')
      .all(topicId) as Array<{ conflict_group_id: string }>
    return rows
      .map((row) => this.getConflictGroup(row.conflict_group_id))
      .filter((group): group is ConflictGroup => group !== null)
  }

  setConflictWinner(groupId: string, winnerMemoryId: string | null, policy: ConflictPolicy, reason: string): void {
    this.db
      .prepare('UPDATE conflict_group SET winner_memory_id = ?, policy = ?, reason = ?, decided_at = ? WHERE conflict_group_id = ?')
      .run(winnerMemoryId, policy, reason, new Date().toISOString(), groupId)
  }

  forgetMemory(
    memoryId: string,
    meta: { deletedAt: string; deletedBy: string; deleteReason: string; tombstoneHash: string },
  ): void {
    this.db
      .prepare(
        `UPDATE memory SET status = 'TOMBSTONED', deleted_at = ?, deleted_by = ?, delete_reason = ?,
         tombstone_hash = ?, updated_at = ? WHERE id = ?`,
      )
      .run(meta.deletedAt, meta.deletedBy, meta.deleteReason, meta.tombstoneHash, meta.deletedAt, memoryId)
  }

  close(): void {
    this.db.close()
  }
}

export function createStorage(options: OpenOptions = {}): SqliteStorage {
  return new SqliteStorage(openDatabase(options))
}
