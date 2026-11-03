import type {
  AuditPort,
  ClockPort,
  ConflictGroup,
  MemoryCandidate,
  MemoryDecision,
  MemoryRecord,
  StoragePort,
  SummaryFact,
} from '@dsh-memory/ports'
import { contextHashOf, factKeyOf, normalizeEntity, normalizeText, normalizeValue, shortHash, valueHashOf } from './normalize.js'
import { decide } from './decide.js'
import { assertTransition } from './state.js'
import { resolveConflict } from './conflict.js'

export interface IngestDeps {
  storage: StoragePort
  clock: ClockPort
  audit?: AuditPort
  tenantId?: string
  /** 摘要已表达的事实槽位（由调用方从当前摘要解析） */
  summaryFacts?: SummaryFact[]
  /** 触发总结的累计 novelty 阈值（§7.3） */
  noveltyThreshold?: number
}

export interface IngestResult {
  memoryId: string | null
  decision: MemoryDecision['decision']
  noveltyScore: number
  needsModel: boolean
  pendingNovelty: number
  summarizeSuggested: boolean
}

const JUDGE_VERSION = 'rules-v1'

function buildRecord(candidate: MemoryCandidate, deps: IngestDeps, now: Date): MemoryRecord {
  const tenantId = candidate.tenantId ?? deps.tenantId ?? 'default'
  const entity = normalizeEntity(candidate.entity)
  const attribute = normalizeText(candidate.attribute)
  const value = normalizeValue(candidate.value)
  const modality = candidate.modality ?? 'asserted'
  const polarity = candidate.polarity ?? 'affirm'
  const conditions = candidate.conditions ?? {}
  const exceptions = candidate.exceptions ?? []
  const factKey = factKeyOf(candidate.topicId, entity, attribute)
  const valueHash = valueHashOf(value)
  const contextHash = contextHashOf(conditions, exceptions, modality, polarity)
  const id = `mem_${shortHash([tenantId, factKey, valueHash, contextHash, now.toISOString()].join('|'))}`
  const content = candidate.content ?? candidate.value
  return {
    id,
    tenantId,
    topicId: candidate.topicId,
    entity,
    attribute,
    value,
    conditions: JSON.stringify(conditions),
    exceptions: JSON.stringify(exceptions),
    factKey,
    valueHash,
    contextHash,
    modality,
    polarity,
    sourceSpeaker: candidate.sourceSpeaker ?? 'user',
    sourceRefs: JSON.stringify(candidate.sourceRefs ?? []),
    content,
    confidence: candidate.confidence ?? 0.6,
    importance: candidate.importance ?? 0.5,
    hotness: 0,
    status: 'PENDING',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    supersededBy: null,
    deletedAt: null,
    tombstoneHash: null,
  }
}

/** 写入一条候选：规则判定 → 落库 → pending 更新（§6.1 阶段 ②–⑤） */
export function ingestCandidate(candidate: MemoryCandidate, deps: IngestDeps): IngestResult {
  const now = deps.clock.now()
  const record = buildRecord(candidate, deps, now)

  if (!record.value) {
    return {
      memoryId: null,
      decision: 'NO_GAIN',
      noveltyScore: 0,
      needsModel: false,
      pendingNovelty: deps.storage.pendingNovelty(candidate.topicId),
      summarizeSuggested: false,
    }
  }

  const result = deps.storage.tx(() => {
    const activeSameFactKey = deps.storage.findActiveByFactKey(record.topicId, record.factKey)
    const pendingMax = deps.storage.pendingNovelty(record.topicId)
    const decision = decide({
      factKey: record.factKey,
      valueHash: record.valueHash,
      contextHash: record.contextHash,
      value: record.value,
      hasConditions: Object.keys(JSON.parse(record.conditions) as Record<string, string>).length > 0,
      hasExceptions: (JSON.parse(record.exceptions) as string[]).length > 0,
      activeSameFactKey,
      summaryFacts: deps.summaryFacts ?? [],
      pendingMaxNovelty: pendingMax,
    })

    // 完全重复 / 纯改述：不新建可检索记忆，只在决策表留痕（§4.4 边界约定）
    const isNoop = decision.decision === 'DUPLICATE' || decision.decision === 'PARAPHRASE'
    const memoryId: string | null = isNoop ? null : record.id

    if (!isNoop) {
      deps.storage.insertMemory(record)
      assertTransition('PENDING', 'ACTIVE')
      deps.storage.updateMemoryStatus(record.id, 'ACTIVE', { updatedAt: now.toISOString() })
    }

    // 修正 vs 冲突（§6.2 / §11.4.1）：
    // - 用户显式纠正（intent=correct）→ 旧值 SUPERSEDED
    // - 工具/助手观察（intent=assert）→ 保留双方，建 conflict_group 并裁决
    if (decision.decision === 'CORRECTION') {
      const overlapping = activeSameFactKey.filter((m) => m.contextHash === record.contextHash)
      const intent =
        candidate.intent
        ?? (record.sourceSpeaker === 'tool' || record.sourceSpeaker === 'assistant' || record.sourceSpeaker === 'imported'
          ? 'assert'
          : 'correct')

      if (intent === 'correct') {
        for (const old of overlapping) {
          assertTransition('ACTIVE', 'SUPERSEDED')
          deps.storage.updateMemoryStatus(old.id, 'SUPERSEDED', {
            supersededBy: record.id,
            updatedAt: now.toISOString(),
          })
        }
      } else if (overlapping.length > 0) {
        const members: MemoryRecord[] = [...overlapping, record]
        const resolution = resolveConflict(members)
        const group: ConflictGroup = {
          groupId: `cg_${shortHash([record.topicId, record.factKey, ...members.map((m) => m.id)].join('|'))}`,
          tenantId: record.tenantId,
          topicId: record.topicId,
          factKey: record.factKey,
          memberMemoryIds: members.map((m) => m.id),
          winnerMemoryId: resolution.winnerMemoryId,
          policy: resolution.policy,
          decidedAt: now.toISOString(),
          reason: resolution.reason,
        }
        deps.storage.createConflictGroup(group)
        // 冲突不得进入摘要的确定性表述（§11.4.1 硬约束 2）
        deps.storage.markSummaryStale(record.topicId)
      }
    }

    if (decision.noveltyScore > 0) {
      deps.storage.upsertPending({
        topicId: record.topicId,
        factKey: record.factKey,
        memoryId: record.id,
        noveltyScore: decision.noveltyScore,
      })
    }

    const memoryDecision: MemoryDecision = {
      decisionId: `dec_${shortHash(record.id + decision.decision)}`,
      memoryId: memoryId ?? activeSameFactKey[0]?.id ?? record.id,
      topicId: record.topicId,
      factKey: record.factKey,
      decision: decision.decision,
      noveltyScore: decision.noveltyScore,
      coveredBy: activeSameFactKey[0]?.id ?? '',
      judge: 'rule',
      judgeVersion: JUDGE_VERSION,
      reason: decision.reason,
      createdAt: now.toISOString(),
    }
    deps.storage.insertDecision(memoryDecision)

    const pendingNovelty = deps.storage.pendingNovelty(record.topicId)
    return { decision, pendingNovelty, memoryId }
  })

  void deps.audit?.append({
    actor: 'memory-core',
    action: 'ingest',
    targetType: 'memory',
    targetId: record.id,
    detail: JSON.stringify({ decision: result.decision.decision, novelty: result.decision.noveltyScore }),
    createdAt: now.toISOString(),
  })

  return {
    memoryId: result.memoryId,
    decision: result.decision.decision,
    noveltyScore: result.decision.noveltyScore,
    needsModel: result.decision.needsModel,
    pendingNovelty: result.pendingNovelty,
    // §7.3 优先级 2：用户修正属于高价值增量，立即进入总结候选
    summarizeSuggested:
      result.decision.decision === 'CORRECTION'
      || result.pendingNovelty >= (deps.noveltyThreshold ?? 3),
  }
}
