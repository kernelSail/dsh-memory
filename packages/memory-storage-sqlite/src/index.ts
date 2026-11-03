import { DatabaseSync } from 'node:sqlite'
import type {
  MemoryDecision,
  MemoryRecord,
  MemoryStatus,
  PendingEntry,
  StoragePort,
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

  close(): void {
    this.db.close()
  }
}

export function createStorage(options: OpenOptions = {}): SqliteStorage {
  return new SqliteStorage(openDatabase(options))
}
