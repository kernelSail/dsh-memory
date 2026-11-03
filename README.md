# dsh-memory

DSH 记忆插件实现（对应《记忆插件核心架构设计 V1.1》）。

## 结构

```
packages/
  memory-ports/            # Port 接口与领域类型（无依赖）
  memory-core/             # 增量判定 / 检索 / 总结 / 冲突 / 删除（纯逻辑）
  memory-storage-sqlite/   # node:sqlite 实现（FTS5 trigram + 迁移）
  memory-adapter-dsh/      # cordis 插件适配层（三钩子 + memory_search）
conformance/               # 契约测试
```

## 已实现

| 模块 | 内容 | 测试 |
|---|---|---|
| 增量判定 | 7 类 decision、fact_key/value_hash/context_hash、pending 累计 | 8 |
| 状态机 | MemoryStatus 迁移表 + 8 条非法迁移拦截 | 2 |
| 写入链路 | 规则判定 → 落库 → 修正 SUPERSEDED / 观察冲突建组 | 契约 |
| 增量总结 | 阈值/强制触发、LLM、规则校验、DRAFT→VALIDATED→ACTIVE、CAS、pending 清理 | 5 |
| 冲突 | 5 级裁决（来源→置信度→新近→未消解）、成组注入、摘要 stale | 5 + 2 |
| 删除 | 墓碑、tombstone_hash、摘要 stale 传播、审计 | 2 |
| 存储 | node:sqlite、FTS5 trigram、事务、唯一索引、迁移版本 | 6 |
| 检索 | FTS + 短词 LIKE、fact 去重、规则重排、token 预算、冲突补全 | 契约 |
| 适配器 | 三钩子接口、fail-open、memory_search 工具骨架 | 类型检查 |

## 开发

```bash
pnpm install
pnpm test        # 31 tests
pnpm typecheck
```

## 下一步

- DSH 真实接线：`ctx.llm` / `ctx.systemPrompt` / `ctx.tools` / `turn/end` 事件
- 本地嵌入（bge-small-zh）与 sqlite-vec 接入
- purge 任务、导出/导入（NDJSON）
- 与 V1.1 §20.10 一致性套件对齐
