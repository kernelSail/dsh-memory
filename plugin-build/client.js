/**
 * 记忆插件前端页面（浏览器端）。
 *
 * 以 `settings.section` 插槽注册为「设置 → 记忆」页面：
 * 统计、检索、按主题筛选、删除（墓碑）与硬删、导出 NDJSON。
 * 数据来自宿主插件注册的 /plugins/dsh-memory/* 接口。
 */
const React = require('react')

const h = React.createElement
const API = '/plugins/dsh-memory'

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0, padding: '4px 2px' },
  header: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 16, fontWeight: 600, margin: 0 },
  subtitle: { fontSize: 12, opacity: 0.6 },
  stats: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  stat: {
    flex: '1 1 90px',
    minWidth: 90,
    border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.25))',
    borderRadius: 10,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  statValue: { fontSize: 18, fontWeight: 600, lineHeight: 1.2 },
  statLabel: { fontSize: 11, opacity: 0.6 },
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  input: {
    flex: '1 1 220px',
    minWidth: 160,
    padding: '7px 10px',
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.3))',
    background: 'transparent',
    color: 'inherit',
    fontSize: 13,
  },
  button: {
    padding: '7px 12px',
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.3))',
    background: 'transparent',
    color: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
  },
  buttonDanger: { color: 'var(--dsw-alias-label-error, #d92d20)' },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: {
    padding: '3px 9px',
    borderRadius: 999,
    border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.25))',
    fontSize: 12,
    cursor: 'pointer',
    background: 'transparent',
    color: 'inherit',
  },
  chipActive: { background: 'rgba(127,127,127,.16)' },
  list: { display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 0, flex: 1, paddingRight: 4 },
  card: {
    border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.22))',
    borderRadius: 10,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  cardTop: { display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between' },
  content: { fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  meta: { display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, opacity: 0.65 },
  tag: { padding: '1px 6px', borderRadius: 4, background: 'rgba(127,127,127,.14)' },
  empty: { padding: '28px 8px', textAlign: 'center', fontSize: 13, opacity: 0.6 },
  error: {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-error, rgba(217,45,32,.4))',
    fontSize: 12,
  },
  footer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, opacity: 0.6 },
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

async function api(path, options) {
  const response = await fetch(API + path, {
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(options?.body ? { 'content-type': 'application/json' } : {}) },
    ...options,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
  return payload
}

function Stat(props) {
  return h('div', { style: styles.stat }, h('div', { style: styles.statValue }, String(props.value)), h('div', { style: styles.statLabel }, props.label))
}

function MemoryCard(props) {
  const { memory, onForget, onPurge, busy } = props
  const deleted = Boolean(memory.deletedAt) || memory.status === 'TOMBSTONED'
  return h(
    'div',
    { style: styles.card },
    h(
      'div',
      { style: styles.cardTop },
      h('div', { style: styles.content }, memory.content || `${memory.entity} · ${memory.attribute} = ${memory.value}`),
      h(
        'div',
        { style: { display: 'flex', gap: 6, flexShrink: 0 } },
        deleted
          ? h('button', { style: { ...styles.button, ...styles.buttonDanger }, disabled: busy, onClick: () => onPurge(memory) }, '彻底删除')
          : h('button', { style: styles.button, disabled: busy, onClick: () => onForget(memory) }, '删除'),
      ),
    ),
    h(
      'div',
      { style: styles.meta },
      h('span', { style: styles.tag }, memory.topicId),
      h('span', { style: styles.tag }, memory.status),
      h('span', { style: styles.tag }, memory.modality),
      h('span', null, `${memory.entity} · ${memory.attribute}`),
      h('span', null, `重要度 ${Number(memory.importance ?? 0).toFixed(2)}`),
      h('span', null, formatTime(memory.updatedAt)),
      memory.validFrom ? h('span', null, `生效 ${formatTime(memory.validFrom)}`) : null,
      memory.validUntil ? h('span', null, `失效 ${formatTime(memory.validUntil)}`) : null,
    ),
  )
}

function MemorySection() {
  const [stats, setStats] = React.useState(null)
  const [memories, setMemories] = React.useState([])
  const [query, setQuery] = React.useState('')
  const [topicId, setTopicId] = React.useState('')
  const [includeDeleted, setIncludeDeleted] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [lastRefresh, setLastRefresh] = React.useState('')

  const load = React.useCallback(
    async (options) => {
      const q = options?.query ?? query
      const topic = options?.topicId ?? topicId
      const deleted = options?.includeDeleted ?? includeDeleted
      setLoading(true)
      setError('')
      try {
        const [nextStats, list] = await Promise.all([
          api('/stats'),
          api(
            `/list?limit=300&query=${encodeURIComponent(q)}&topicId=${encodeURIComponent(topic)}&includeDeleted=${deleted ? '1' : '0'}`,
          ),
        ])
        setStats(nextStats)
        setMemories(list.memories || [])
        setLastRefresh(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      } catch (err) {
        setError(String(err && err.message ? err.message : err))
      } finally {
        setLoading(false)
      }
    },
    [query, topicId, includeDeleted],
  )

  React.useEffect(() => {
    load()
    // 只在挂载时加载一次；后续由用户操作触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onForget = React.useCallback(
    async (memory) => {
      setBusy(true)
      try {
        await api('/forget', { method: 'POST', body: JSON.stringify({ memoryId: memory.memoryId }) })
        await load()
      } catch (err) {
        setError(String(err && err.message ? err.message : err))
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  const onPurge = React.useCallback(
    async (memory) => {
      setBusy(true)
      try {
        await api('/purge', { method: 'POST', body: JSON.stringify({ memoryId: memory.memoryId }) })
        await load()
      } catch (err) {
        setError(String(err && err.message ? err.message : err))
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  const topics = stats && Array.isArray(stats.topics) ? stats.topics : []

  return h(
    'div',
    { style: styles.page },
    h(
      'div',
      { style: styles.header },
      h('h2', { style: styles.title }, '长期记忆'),
      h('span', { style: styles.subtitle }, lastRefresh ? `最后刷新 ${lastRefresh}` : '正在加载…'),
    ),
    h(
      'div',
      { style: styles.stats },
      h(Stat, { label: '总数', value: stats ? stats.total : '—' }),
      h(Stat, { label: '活跃', value: stats ? stats.active : '—' }),
      h(Stat, { label: '已删除', value: stats ? stats.tombstoned : '—' }),
      h(Stat, { label: '主题', value: stats ? topics.length : '—' }),
    ),
    h(
      'div',
      { style: styles.toolbar },
      h('input', {
        style: styles.input,
        placeholder: '搜索记忆内容 / 实体 / 属性…',
        value: query,
        onChange: (event) => setQuery(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter') load({ query: event.currentTarget.value })
        },
      }),
      h('button', { style: styles.button, onClick: () => load(), disabled: loading }, loading ? '查询中…' : '查询'),
      h(
        'button',
        {
          style: includeDeleted ? { ...styles.button, ...styles.chipActive } : styles.button,
          onClick: () => {
            const next = !includeDeleted
            setIncludeDeleted(next)
            load({ includeDeleted: next })
          },
        },
        includeDeleted ? '含已删除' : '仅活跃',
      ),
      h('a', { style: { ...styles.button, textDecoration: 'none' }, href: API + '/export', download: 'memories.ndjson' }, '导出 NDJSON'),
    ),
    topics.length > 0
      ? h(
          'div',
          { style: styles.chips },
          h(
            'button',
            {
              style: topicId === '' ? { ...styles.chip, ...styles.chipActive } : styles.chip,
              onClick: () => {
                setTopicId('')
                load({ topicId: '' })
              },
            },
            '全部主题',
          ),
          topics.map((topic) =>
            h(
              'button',
              {
                key: topic.topicId,
                style: topicId === topic.topicId ? { ...styles.chip, ...styles.chipActive } : styles.chip,
                onClick: () => {
                  setTopicId(topic.topicId)
                  load({ topicId: topic.topicId })
                },
              },
              `${topic.topicId} · ${topic.count}`,
            ),
          ),
        )
      : null,
    error ? h('div', { style: styles.error }, error) : null,
    h(
      'div',
      { style: styles.list },
      memories.length === 0 && !loading
        ? h('div', { style: styles.empty }, query || topicId ? '没有匹配的记忆' : '还没有记忆。对话几轮后会自动提取。')
        : memories.map((memory) => h(MemoryCard, { key: memory.memoryId, memory, busy, onForget, onPurge })),
    ),
    h(
      'div',
      { style: styles.footer },
      h('span', null, `共 ${memories.length} 条${stats ? ` / 库内 ${stats.total} 条` : ''}`),
      stats && stats.lastUpdated ? h('span', null, `最新写入 ${formatTime(stats.lastUpdated)}`) : null,
    ),
  )
}

/** 插件显示名（Loader 会忽略，仅供调试）。 */
const name = 'dsh-memory-plugin'
/** 需要的浏览器服务。 */
const inject = ['slots']

function apply(ctx) {
  ctx.effect(() =>
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'memory',
          order: 55,
          label: () => '记忆',
        },
        MemorySection,
      ),
    ),
  )
}

export { name, inject, apply }
