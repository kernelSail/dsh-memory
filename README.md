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

# 重新打包插件（dist + 可安装包）
pnpm build:plugin
```

## 安装到 DSH（作为设置页可见的插件包）

裸 `insert` 一个 `file://` 模块虽然能跑，但**不会出现在「设置 → 插件」**：设置页的插件清单从 Loader 条目读取包元信息（`locale/*.json` 的 `meta.title`），而 app-boot 对文件 URL 不做包解析、直接返回无元信息。

正确做法是作为 bundle 安装：

```bash
# 1) 把 plugin-build/pkg 放进 profile（可在 profile 目录内，供 file: 依赖使用）
cp -r plugin-build/pkg ~/.dsh/profiles/desktop/.local-plugins/dsh-memory-plugin

# 2) profile 目录里建 node_modules junction
#    C:\Users\liuwei\.dsh\profiles\desktop\node_modules\dsh-memory-plugin -> .local-plugins/dsh-memory-plugin

# 3) profile package.json 声明依赖与 bundle
#    dependencies."dsh-memory-plugin" = "file:.local-plugins/dsh-memory-plugin"
#    dsh.profile.bundles += "dsh-memory-plugin"

# 4) profile cordis.patch.yml 里不再需要 memory 插件的 insert 块（由包内 bundle patch 负责）
```

包结构：

```
plugin-build/pkg/
  package.json        # dsh.bundle.patch + dsh.manifestVersion
  cordis.patch.yml    # insert dsh-memory-plugin（含 dbPath / provider 配置）
  lib/index.js        # esbuild 产物
  locale/{zh,en}.json # 设置页显示名与描述
```

> bundle 列表变化需要**重启 DSH** 才会重新组合 Loader；改配置块（`cordis.patch.yml`）才走 HMR 热更新。

## 成本（估算，批量提取后）

假设：每轮内容约 2,700 tokens；**每 4 轮批量提取 1 次**（指令 800 tokens）；每轮约 3 条记忆、每条 60 tokens；每 15 轮 1 次摘要（50% 走校验）；每轮注入 800 tokens；缓存命中率 40%；本地嵌入 0 token。
价格按 DeepSeek 官方（USD/1M tokens）：flash 峰值 命中 $0.006 / 未命中 $0.30 / 输出 $1.20，低谷减半；v4-pro 约为 flash 的 4.4 倍。

| 场景 | 轮次/月 | tokens/月 | flash 峰值 | 低谷 | v4-pro |
|---|---|---|---|---|---|
| 轻度（20 轮×22 天） | 440 | 1.80M in / 0.13M out | **$0.48** | $0.24 | $1.95 |
| 中度（60 轮×22 天） | 1,320 | 5.39M in / 0.38M out | **$1.43** | $0.72 | $5.85 |
| 重度（150 轮×22 天） | 3,300 | 13.46M in / 0.94M out | **$3.58** | $1.79 | $14.62 |

批量效果：每轮提取时中度约 **$1.82/月**，改成每 4 轮批量后 **$1.43/月（约 -21%）**，提取调用次数降到 1/4。
对比：把完整历史（约 10k tokens/轮）塞进上下文，仅输入就要约 **$3.96/月**；记忆方案合计约 **$1.43/月**。

> 口径说明：实现目前只做规则判定（无模型兜底）与规则适用性验证，所以比设计文档附录 G 的 4,209/302 略低（实际 4,080/285）。

## 前端页面（右侧栏 tab + 设置 → 记忆）

插件带一个浏览器端页面，注册两个入口：

1. **右侧栏 tab**（文件 / 浏览器 / 终端那一列）：`sidebarRightTabs.register` 声明 tab 类型（`kind: memory`），`sidebar.right.pane.tab` 注册主体、`sidebar.right.pane.tab.title` 注册标题。右侧栏 guide 里多一张「记忆」卡片，点击即打开；也可以从右侧栏的「+」菜单选。
2. **设置 → 记忆**（`settings.section` 插槽，与壁纸插件同一套入口）。

页面能力：统计、关键词检索（FTS）+ 主题筛选 +「仅活跃 / 含已删除」、墓碑删除 / 彻底删除、NDJSON 导出。

### 空间视图（3D）

默认进入「空间」模式（右上角可切回「列表」），把记忆画成一个可旋转的三维网络：

- **节点**：记忆点（大小=importance，颜色=状态/主题）、实体枢纽（青色）、主题星团（紫色）；
- **连边**：同实体 / 同主题 / 冲突（红色虚线）/ 取代链（黄色）；
- **交互**：空白拖拽旋转（yaw/pitch）、滚轮缩放、悬停高亮并显示摘要、点击节点弹出详情卡（可删除/彻底删除）、搜索命中节点描金边并压暗其余、主题 chips 过滤；
- **实现**：Canvas 2D + 透视投影的伪 3D，自己写的 3D 力导向（斥力 + 弹簧 + 向心），无 three.js 等新依赖；布局用确定性随机种子，同一份数据每次打开形状一致；
- **规模**：默认最多 400 条记忆节点，超出截断并提示；数据更多时应改为主题/实体聚合 + 钻取。

数据来自宿主插件注册的 `/plugins/dsh-memory/*` 路由（仅 loopback）：

| 路由 | 说明 |
|---|---|
| `GET /plugins/dsh-memory/stats` | 统计与主题分布 |
| `GET /plugins/dsh-memory/list?query=&topicId=&includeDeleted=&limit=` | 列表 / 检索 |
| `GET /plugins/dsh-memory/graph?query=&topicId=&includeDeleted=&limit=` | 空间视图的节点 + 连边（含 `matched` 标记） |
| `POST /plugins/dsh-memory/forget` `{memoryId}` | 墓碑删除 |
| `POST /plugins/dsh-memory/purge` `{memoryId}` | 硬删（需先 forget） |
| `GET /plugins/dsh-memory/export` | NDJSON 导出 |

构建产物：`pkg/lib/index.js`（宿主）+ `pkg/lib/client.js`（浏览器，包装成 DSH 的 `__ModuleLoader__` 工厂，`react` 走 externals）。

> **前端 bundle 的硬性要求**：DSH 的 factory 作用域里没有 Node 的 `module`/`exports`，包装时必须先写
> `var module = { exports: {} }; var exports = module.exports;`，否则客户端会报
> `dsh-memory-plugin: import failed: module is not defined`，web boot 失败并弹出致命错误框。
> `build.mjs` 已加断言防回归，沙箱测试见 `plugin-build/` 构建脚本。

## 故障恢复（重要）

DSH 遇到首个致命启动错误时会弹出对话框，按钮是「退出 / 重启 / **禁用第三方插件**」。
点「禁用第三方插件」会执行 `sanitizeProfile`：把 `cordis.patch.yml` 备份成
`cordis.patch.yml.bak-<timestamp>`、把 `package.json` 的 bundles 重置为 `dsh-base + dsh-web-app`。

- 崩溃报告：`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-<ISO>-<source>.log`（`source` 如 `web-boot`）；
- 恢复配置：用备份的 `cordis.patch.yml.bak-*` + 原 `package.json` 覆盖回去即可（本仓库恢复过两次）；
- 本插件历史崩溃原因：`dsh-memory-plugin: import failed: module is not defined`（客户端包装缺 module shim），已修复。

## 启用 / 关闭（本机）

- 安装：profile 的 `node_modules/dsh-memory-plugin`（指向 `.local-plugins/`）+ `package.json` 的 `dsh.profile.bundles`；
- 配置：插件包内 `cordis.patch.yml`（dbPath / provider / model / extractBatchTurns）；
- 数据库：`D:\study\deepseek-work\dsh-memory\live-memory.db`；
- 关闭：从 `dsh.profile.bundles` 移除 `dsh-memory-plugin`（需重启），或在 bundle patch 里把配置改为 `enabled: false`。
- 设置页可见性：需要**重启 DSH**（bundle 列表变更不热更新）。

## 本轮优化（2026-11-04）

| 优化 | 实现 | 验证 |
|---|---|---|
| 批量提取 | `extractBatchTurns`（默认 4）：轮末入缓冲，满 4 轮才调一次 LLM；关停时 `flush()` 处理尾巴 | 3 轮不调模型、第 4 轮仅 1 次调用 |
| 主题分类 | 提取提示带上已有主题并复用；topic 规范化 slug；检索本主题无命中时跨主题回退 | 跨主题检索、slug 规范化测试 |
| 显式写入 | 新增 `memory_write` 工具（entity/attribute/value/content/topic/validFrom/validUntil） | 写入返回 NEW_FACT 并落库 |
| TEMPORAL | `valid_from/valid_until` 入库（迁移 7）；裁决赛第一级为时间窗 | 时间窗不重叠时按参考时间裁决 |

## 已知限制

- 每批提取仍需一次 LLM 调用；对话不足 4 轮时关停会补一次（由 `flush` 触发）；
- 主题由 LLM 生成，尚无人工确认/合并机制；
- `memory_write` 不做实体归一化建议，写入质量依赖调用方；
- `TEMPORAL` 只比较「参考时间点是否有效」，不处理部分重叠的复杂窗口。
