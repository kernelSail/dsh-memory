# dsh-memory

DSH 记忆插件实现（对应《记忆插件核心架构设计 V1.1》）。

## 结构

```
packages/
  memory-ports/            # Port 接口与领域类型（无依赖）
  memory-core/             # 判定 / 检索 / 总结 / 冲突 / 删除 / 提取 / 导入导出
  memory-storage-sqlite/   # node:sqlite 实现（FTS5 trigram + 迁移）
  memory-adapter-dsh/      # cordis 接线（ctx.llm / systemPrompt / tools / session 事件）
conformance/               # 契约测试
```

## 已实现

| 模块 | 内容 | 测试 |
|---|---|---|
| 增量判定 | 7 类 decision、fact_key/value_hash/context_hash、pending 累计 | 8 |
| 状态机 | MemoryStatus 迁移表 + 8 条非法迁移拦截 | 2 |
| 写入链路 | 规则判定 → 落库 → 修正 SUPERSEDED / 观察冲突建组 | 契约 |
| 候选提取 | LLM 提取 + JSON 校验 + fail-open | 5 |
| 增量总结 | 阈值/强制触发、LLM、规则校验、DRAFT→VALIDATED→ACTIVE、CAS、pending 清理 | 5 |
| 冲突 | 5 级裁决（来源→置信度→新近→未消解）、成组注入、摘要 stale | 5 + 2 |
| 删除 | 墓碑、tombstone_hash、摘要 stale 传播、审计 | 2 |
| Purge | 硬删内容（仅限已 forget），保留 tombstone | 1 |
| 导出/导入 | NDJSON（memory/summary/conflict/decision）、merge/replace | 3 |
| 存储 | node:sqlite、FTS5 trigram、事务、唯一索引、迁移版本 | 6 |
| 检索 | FTS + 短词 LIKE、fact 去重、规则重排、token 预算、冲突补全 | 契约 |
| DSH 适配器 | `ctx.llm.stream` → LLMPort（text-delta 组装）、systemPrompt 段、memory_search 工具、session/event 缓冲与 turn/end 提取 | 10 |

## 开发

```bash
pnpm install
pnpm test        # 50 tests
pnpm typecheck
```

## 已知限制

- 适配器按 DSH 文档协议实现（StreamChunk / systemPrompt.section / tools.register / `session/event`），但尚未在真实 DSH 插件运行时里跑过端到端；`defineTool` 当前用结构等价的普通对象注册。
- 冲突裁决的 `TEMPORAL` 策略未启用（记录未带 valid_from/valid_until）。
- 本地嵌入 + sqlite-vec 尚未接入。

## 下一步

- 在 DSH 中加载插件做端到端验证（turn/end 事件载荷形状需实测）
- 本地嵌入（bge-small-zh）与 sqlite-vec
- 与 V1.1 §20.10 一致性套件对齐
