# dsh-memory

DSH 记忆插件实现（对应《记忆插件核心架构设计 V1.1》）。

## 结构

```
packages/
  memory-ports/            # Port 接口与领域类型（无依赖）
  memory-core/             # 增量判定 / 检索 / 总结（纯逻辑）
  memory-storage-sqlite/   # node:sqlite 实现（FTS5 trigram）
  memory-adapter-dsh/      # cordis 插件适配层（ctx.llm / systemPrompt / tools）
conformance/               # 契约测试
```

## 开发

```bash
pnpm install
pnpm test
pnpm typecheck
```

## 实现顺序

1. ports + core 判定规则（当前）
2. SQLite 存储与 FTS 检索
3. retrieve 组装与预算
4. summarize / 状态机
5. DSH 适配器接线
