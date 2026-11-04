# dsh-memory

DSH 记忆插件实现（对应《记忆插件核心架构设计 V1.1》）。

## 结构

```
packages/
  memory-ports/            # Port 接口与领域类型（无依赖）
  memory-core/             # 判定 / 检索 / 总结 / 冲突 / 删除 / 提取 / 导入导出
  memory-storage-sqlite/   # node:sqlite 实现（FTS5 trigram + 迁移）
  memory-adapter-dsh/      # cordis 接线（ctx.llm / systemPrompt / tools / session 事件）
plugin-build/              # 单文件 ESM 打包入口（真实宿主加载用）
conformance/               # 契约测试
```

## 已实现

| 模块 | 内容 | 测试 |
|---|---|---|
| 增量判定 | 7 类 decision、fact_key/value_hash/context_hash、pending 累计 | 8 |
| 状态机 | MemoryStatus 迁移表 + 8 条非法迁移拦截 | 2 |
| 写入链路 | 规则判定 → 落库 → 修正 SUPERSEDED / 观察冲突建组 | 契约 |
| 候选提取 | LLM 提取 + JSON 校验 + 默认主题覆盖 + fail-open | 5 |
| 增量总结 | 阈值/强制触发、LLM、规则校验、DRAFT→VALIDATED→ACTIVE、CAS、pending 清理 | 5 |
| 冲突 | 5 级裁决（来源→置信度→新近→未消解）、成组注入、摘要 stale | 5 + 2 |
| 删除 | 墓碑、tombstone_hash、摘要 stale 传播、审计 | 2 |
| Purge | 硬删内容（仅限已 forget），保留 tombstone | 1 |
| 导出/导入 | NDJSON（memory/summary/conflict/decision）、merge/replace | 3 |
| 存储 | node:sqlite、FTS5 trigram、事务、唯一索引、迁移版本 | 6 |
| 检索 | FTS + 短词 LIKE、fact 去重、规则重排、token 预算、冲突补全 | 契约 |
| DSH 适配器 | `ctx.llm.stream` → LLMPort、systemPrompt 段、memory_search 工具、`session/event`（双参数）、turn/end 提取 | 10 |

## 真实宿主验证（2026-11-04）

1. 从 `app.asar` 提取 DSH 运行时，用 `dsh --profile headless` 在独立 `DSH_HOME` 下启动，通过 `insert` patch 加载 `plugin-build/dist/index.js`。
2. 第 1 轮「记住：权限模型是 RBAC，用户可加入多个组织」→ 写入 2 条记忆（topic `smoke`）。
3. 第 2 轮「先调用 memory_search 检索『权限模型』再回答」→ 工具返回 RBAC，最终答案 **RBAC**。
4. 桌面版：patch 变更被 HMR 捕获，插件已加载；`memory_search` 出现在工具列表，db 为 `live-memory.db`。

关键适配点（真实宿主要求）：

- cordis 插件必须 `export const inject = ['llm','systemPrompt','tools']`；
- `apply` 的返回值必须是 effect（返回异步 dispose/flush），否则报 `Invalid effect`；
- `ctx.on('session/event', (session, event) => ...)` 是**双参数**，事件在 `event.type/data`；
- 工具必须声明 `output: { schema, render }`；
- 只注入真实用户消息（`source.kind === 'user'`），跳过 runtime context / skill reminder。

## 开发

```bash
pnpm install
pnpm test        # 50 tests
pnpm typecheck

# 重新打单文件插件（DSH 加载用）
node_modules/.bin/esbuild plugin-build/entry.ts --bundle --format=esm \
  --platform=node --target=node22 --outfile=plugin-build/dist/index.js
```

## 启用 / 关闭（本机）

- 配置：`~/.dsh/profiles/desktop/cordis.patch.yml` 末尾的 `insert` 块；
- 数据库：`D:\study\deepseek-work\dsh-memory\live-memory.db`；
- 关闭：删除该 `insert` 块（HMR 会卸载），或把插件配置改为 `enabled: false`。

## 已知限制

- 每轮 `turn/end` 都触发一次提取 LLM 调用（尚未做 4 轮批量），成本高于设计估算；
- 主题分类未启用，统一落到 `defaultTopicId`；
- 只有 `memory_search` 工具，没有显式 `memory_write`；
- 冲突 `TEMPORAL` 策略未启用（记录未带 valid_from/valid_until）。
