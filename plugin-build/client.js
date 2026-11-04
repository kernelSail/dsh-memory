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

let lastDiagAt = 0
/** 把页面侧的关键事实写到宿主日志，便于在没有 DevTools 的桌面壳里定位空白页。 */
function sendDiag(payload) {
  try {
    const now = Date.now()
    if (now - lastDiagAt < 800) return
    lastDiagAt = now
    fetch(API + '/diag', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  } catch {
    // 诊断失败不影响页面
  }
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

function MemorySection(props) {
  const pane = props?.variant === 'pane'
  const [stats, setStats] = React.useState(null)
  const [memories, setMemories] = React.useState([])
  const [query, setQuery] = React.useState('')
  const [topicId, setTopicId] = React.useState('')
  const [includeDeleted, setIncludeDeleted] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [lastRefresh, setLastRefresh] = React.useState('')
  // 默认进空间视图；列表视图留给大量数据/精确操作
  const [mode, setMode] = React.useState('space')

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
    { style: pane ? { ...styles.page, padding: '8px 10px' } : styles.page },
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
      h(
        'div',
        { style: { display: 'flex', gap: 4, marginLeft: 'auto' } },
        h(
          'button',
          {
            style: mode === 'space' ? { ...styles.button, ...styles.chipActive } : styles.button,
            onClick: () => setMode('space'),
          },
          '空间',
        ),
        h(
          'button',
          {
            style: mode === 'list' ? { ...styles.button, ...styles.chipActive } : styles.button,
            onClick: () => setMode('list'),
          },
          '列表',
        ),
      ),
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
    mode === 'space'
      ? h(MemorySpace, { query, topicId, includeDeleted })
      : [
          h(
            'div',
            { key: 'list', style: styles.list },
            memories.length === 0 && !loading
              ? h('div', { style: styles.empty }, query || topicId ? '没有匹配的记忆' : '还没有记忆。对话几轮后会自动提取。')
              : memories.map((memory) => h(MemoryCard, { key: memory.memoryId, memory, busy, onForget, onPurge })),
          ),
          h(
            'div',
            { key: 'footer', style: styles.footer },
            h('span', null, `共 ${memories.length} 条${stats ? ` / 库内 ${stats.total} 条` : ''}`),
            stats && stats.lastUpdated ? h('span', null, `最新写入 ${formatTime(stats.lastUpdated)}`) : null,
          ),
        ],
  )
}

// ---------------- 3D 空间视图（伪 3D，Canvas 2D 透视投影） ----------------

const SPACE_DEFAULTS = { yaw: 0.45, pitch: 0.22, zoom: 1, panX: 0, panY: 0 }

function seededRandom(seed) {
  let state = (seed >>> 0) || 1
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >> 17
    state ^= state << 5
    state >>>= 0
    return state / 4294967296
  }
}

function nodeRadius(node, scale) {
  const base = node.kind === 'memory' ? 2.6 + Math.min(1, Number(node.importance ?? 0.5)) * 4.2 : node.kind === 'entity' ? 4.4 : 5.2
  return Math.max(1.6, Math.min(14, base * (0.85 + scale * 0.5)))
}

function buildLayout(graph) {
  const random = seededRandom(20261104)
  const nodes = (graph.nodes || []).map((node) => ({ ...node }))
  const position = new Map()
  const n = Math.max(1, nodes.length)
  nodes.forEach((node, index) => {
    const spread = node.kind === 'memory' ? 140 : 90
    const radius = spread * (0.35 + random() * 0.9)
    const theta = random() * Math.PI * 2
    const phi = Math.acos(2 * random() - 1)
    position.set(node.id, {
      x: Math.sin(phi) * Math.cos(theta) * radius,
      y: Math.sin(phi) * Math.sin(theta) * radius * 0.85,
      z: Math.cos(phi) * radius,
      vx: 0,
      vy: 0,
      vz: 0,
      sx: 0,
      sy: 0,
      scale: 1,
      radius: 3,
    })
  })
  const links = (graph.links || []).filter((link) => position.has(link.source) && position.has(link.target))
  return { nodes, links, position, count: n }
}

function stepLayout(layout, alpha) {
  const nodes = layout.nodes
  const pos = layout.position
  const count = nodes.length
  if (count === 0) return

  for (let i = 0; i < count; i++) {
    const node = nodes[i]
    const point = pos.get(node.id)
    const gravity = node.kind === 'memory' ? 0.012 : 0.035
    point.vx -= point.x * gravity
    point.vy -= point.y * gravity
    point.vz -= point.z * gravity
  }

  const repulsion = 900
  for (let i = 0; i < count; i++) {
    const a = pos.get(nodes[i].id)
    for (let j = i + 1; j < count; j++) {
      const b = pos.get(nodes[j].id)
      let dx = a.x - b.x
      let dy = a.y - b.y
      let dz = a.z - b.z
      let d2 = dx * dx + dy * dy + dz * dz
      if (d2 < 1) {
        d2 = 1
        dx = 1
        dy = 0.6
        dz = 0.2
      }
      const d = Math.sqrt(d2)
      const force = (repulsion * alpha) / d2
      const fx = (dx / d) * force
      const fy = (dy / d) * force
      const fz = (dz / d) * force
      a.vx += fx
      a.vy += fy
      a.vz += fz
      b.vx -= fx
      b.vy -= fy
      b.vz -= fz
    }
  }

  for (const link of layout.links) {
    const a = pos.get(link.source)
    const b = pos.get(link.target)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
    const rest = link.kind === 'topic' ? 165 : link.kind === 'entity' ? 100 : 70
    const strength = 0.035 * alpha
    const force = (d - rest) * strength
    const ux = dx / d
    const uy = dy / d
    const uz = dz / d
    a.vx += ux * force
    a.vy += uy * force
    a.vz += uz * force
    b.vx -= ux * force
    b.vy -= uy * force
    b.vz -= uz * force
  }

  const limit = 560
  for (let i = 0; i < count; i++) {
    const point = pos.get(nodes[i].id)
    point.vx *= 0.82
    point.vy *= 0.82
    point.vz *= 0.82
    point.x += point.vx
    point.y += point.vy
    point.z += point.vz
    if (point.x > limit) point.x = limit
    else if (point.x < -limit) point.x = -limit
    if (point.y > limit) point.y = limit
    else if (point.y < -limit) point.y = -limit
    if (point.z > limit) point.z = limit
    else if (point.z < -limit) point.z = -limit
  }
}

function projectLayout(layout, view, width, height) {
  const cx = width / 2 + view.panX
  const cy = height / 2 + view.panY
  const distance = 900
  const focal = 720 * view.zoom
  const cosYaw = Math.cos(view.yaw)
  const sinYaw = Math.sin(view.yaw)
  const cosPitch = Math.cos(view.pitch)
  const sinPitch = Math.sin(view.pitch)
  for (const node of layout.nodes) {
    const point = layout.position.get(node.id)
    const x1 = point.x * cosYaw + point.z * sinYaw
    const z1 = -point.x * sinYaw + point.z * cosYaw
    const y1 = point.y * cosPitch - z1 * sinPitch
    const z2 = point.y * sinPitch + z1 * cosPitch
    const denom = z2 + distance
    const scale = denom > 60 ? focal / denom : 0
    point.sx = cx + x1 * scale
    point.sy = cy + y1 * scale
    point.scale = scale
    point.depth = z2
    point.radius = nodeRadius(node, scale)
  }
}

function drawScene(ctx, width, height, layout, view, selectedId, hoverId, hasQuery) {
  projectLayout(layout, view, width, height)
  ctx.clearRect(0, 0, width, height)

  const linkColor = (kind) => {
    if (kind === 'conflict') return '248,113,113'
    if (kind === 'supersede') return '251,191,36'
    if (kind === 'topic') return '192,132,252'
    return '148,163,184'
  }

  for (const link of layout.links) {
    const a = layout.position.get(link.source)
    const b = layout.position.get(link.target)
    if (!a || !b) continue
    const depth = Math.max(0, Math.min(1, (a.depth + b.depth + 1100) / 2200))
    const alpha = link.kind === 'conflict' || link.kind === 'supersede' ? 0.75 : 0.16 + depth * 0.22
    ctx.strokeStyle = `rgba(${linkColor(link.kind)},${alpha.toFixed(3)})`
    ctx.lineWidth = link.kind === 'conflict' || link.kind === 'supersede' ? 1.4 : 0.7
    if (link.kind === 'conflict') ctx.setLineDash([4, 4])
    else ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(a.sx, a.sy)
    ctx.lineTo(b.sx, b.sy)
    ctx.stroke()
  }
  ctx.setLineDash([])

  const ordered = [...layout.nodes].sort((left, right) => layout.position.get(right.id).depth - layout.position.get(left.id).depth)
  for (const node of ordered) {
    const point = layout.position.get(node.id)
    if (point.scale <= 0) continue
    const radius = point.radius
    const isSelected = node.id === selectedId
    const isHover = node.id === hoverId
    const dimmed = hasQuery && !node.matched && !isSelected && !isHover
    const color =
      node.kind === 'entity'
        ? '45,212,191'
        : node.kind === 'topic'
          ? '192,132,252'
          : node.status === 'SUPERSEDED'
            ? '251,191,36'
            : node.status === 'TOMBSTONED'
              ? '148,163,184'
              : '96,165,250'
    const alpha = dimmed ? 0.18 : 0.55 + Math.max(0, Math.min(1, (point.depth + 600) / 1200)) * 0.45

    if (isSelected || isHover) {
      ctx.beginPath()
      ctx.arc(point.sx, point.sy, radius + 5, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${color},0.75)`
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
    if (node.matched && hasQuery) {
      ctx.beginPath()
      ctx.arc(point.sx, point.sy, radius + 3.5, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(250,204,21,0.85)'
      ctx.lineWidth = 1.2
      ctx.stroke()
    }

    const gradient = ctx.createRadialGradient(point.sx - radius * 0.3, point.sy - radius * 0.3, 0, point.sx, point.sy, Math.max(1, radius))
    gradient.addColorStop(0, `rgba(255,255,255,${Math.min(0.95, alpha + 0.25).toFixed(3)})`)
    gradient.addColorStop(0.45, `rgba(${color},${alpha.toFixed(3)})`)
    gradient.addColorStop(1, `rgba(${color},0.04)`)
    ctx.beginPath()
    ctx.arc(point.sx, point.sy, radius, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()
  }

  ctx.textBaseline = 'middle'
  ctx.font = '10px ui-sans-serif, system-ui, "Segoe UI", sans-serif'
  for (const node of ordered) {
    const point = layout.position.get(node.id)
    if (point.scale <= 0) continue
    const showLabel =
      node.id === selectedId ||
      node.id === hoverId ||
      node.kind === 'entity' ||
      node.kind === 'topic' ||
      (node.matched && hasQuery) ||
      point.scale > 1.15
    if (!showLabel) continue
    const label = node.kind === 'memory' ? String(node.label || '').slice(0, 26) : `${node.kind === 'entity' ? '· ' : '# '}${node.label}`
    const x = point.sx + point.radius + 5
    const y = point.sy
    ctx.fillStyle = 'rgba(226,232,240,0.82)'
    ctx.fillText(label, x, y)
  }
}

function MemorySpace(props) {
  const query = props?.query || ''
  const topicId = props?.topicId || ''
  const includeDeleted = Boolean(props?.includeDeleted)
  const wrapRef = React.useRef(null)
  const canvasRef = React.useRef(null)
  const layoutRef = React.useRef({ nodes: [], links: [], position: new Map(), count: 0 })
  const viewRef = React.useRef({ ...SPACE_DEFAULTS })
  const alphaRef = React.useRef(1)
  const rafRef = React.useRef(0)
  const dragRef = React.useRef(null)
  const selectedRef = React.useRef(null)
  const hoverRef = React.useRef(null)
  const queryRef = React.useRef(false)

  const [graph, setGraph] = React.useState(null)
  const [stats, setStats] = React.useState(null)
  const [truncated, setTruncated] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState(null)
  const [hoverId, setHoverId] = React.useState(null)
  const [hoverNode, setHoverNode] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  // 诊断：画布尺寸 / 节点数 / 是否有 2D 上下文（画布不可用时回退成 DOM 列表）
  const [diag, setDiag] = React.useState({ w: 0, h: 0, nodes: 0, links: 0, ctx: true })

  React.useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])
  React.useEffect(() => {
    hoverRef.current = hoverId
  }, [hoverId])
  React.useEffect(() => {
    queryRef.current = Boolean(query)
  }, [query])

  React.useEffect(() => {
    let cancelled = false
    let timer = 0
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        const payload = await api(
          `/graph?limit=400&query=${encodeURIComponent(query)}&topicId=${encodeURIComponent(topicId)}&includeDeleted=${includeDeleted ? '1' : '0'}`,
        )
        if (cancelled) return
        setGraph(payload)
        setStats(payload.stats || null)
        setTruncated(Boolean(payload.truncated))
        sendDiag({ where: 'graph', status: 'ok', nodes: payload.nodes?.length, links: payload.links?.length, stats: payload.stats })
      } catch (err) {
        sendDiag({ where: 'graph', status: 'error', message: String(err && err.message ? err.message : err) })
        if (!cancelled) setError(String(err && err.message ? err.message : err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    timer = setTimeout(run, query ? 220 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, topicId, includeDeleted])

  React.useEffect(() => {
    if (!graph) return
    const layout = buildLayout(graph)
    layoutRef.current = layout
    setDiag((prev) => ({ ...prev, nodes: layout.nodes.length, links: layout.links.length }))
    alphaRef.current = 1
    selectedRef.current = null
    setSelectedId(null)
    setHoverId(null)
    setHoverNode(null)
  }, [graph])

  React.useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) setDiag((prev) => ({ ...prev, ctx: false }))
    let width = 0
    let height = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      width = Math.max(1, Math.floor(rect.width))
      height = Math.max(1, Math.floor(rect.height))
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
      setDiag((prev) => (prev.w === width && prev.h === height ? prev : { ...prev, w: width, h: height }))
      sendDiag({
        where: 'resize',
        w: width,
        h: height,
        dpr,
        ctx: Boolean(ctx),
        nodes: layoutRef.current.nodes.length,
        links: layoutRef.current.links.length,
        href: String(globalThis.location?.href ?? ''),
      })
    }
    resize()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    observer?.observe(wrap)

    const frame = () => {
      const layout = layoutRef.current
      if (alphaRef.current > 0.004) {
        stepLayout(layout, alphaRef.current)
        alphaRef.current *= 0.993
      }
      if (ctx && width > 2 && height > 2) {
        drawScene(ctx, width, height, layout, viewRef.current, selectedRef.current, hoverRef.current, queryRef.current)
      }
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafRef.current)
      observer?.disconnect()
    }
  }, [])

  const hitTest = React.useCallback((clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    let best = null
    let bestDistance = Infinity
    for (const node of layoutRef.current.nodes) {
      const point = layoutRef.current.position.get(node.id)
      if (!point || point.scale <= 0) continue
      const distance = Math.hypot(point.sx - x, point.sy - y)
      const hitRadius = Math.max(8, point.radius + 6)
      if (distance <= hitRadius && distance < bestDistance) {
        best = node
        bestDistance = distance
      }
    }
    return best
  }, [])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onPointerDown = (event) => {
      if (event.button !== 0) return
      dragRef.current = { x: event.clientX, y: event.clientY, yaw: viewRef.current.yaw, pitch: viewRef.current.pitch, moved: false }
      canvas.setPointerCapture?.(event.pointerId)
    }
    const onPointerMove = (event) => {
      const drag = dragRef.current
      if (drag && (event.buttons & 1)) {
        const dx = event.clientX - drag.x
        const dy = event.clientY - drag.y
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true
        viewRef.current.yaw = drag.yaw + dx * 0.006
        viewRef.current.pitch = Math.max(-1.3, Math.min(1.3, drag.pitch - dy * 0.006))
        return
      }
      const node = hitTest(event.clientX, event.clientY)
      const nextId = node ? node.id : null
      if (nextId !== hoverRef.current) {
        hoverRef.current = nextId
        setHoverId(nextId)
        setHoverNode(node)
      }
    }
    const onPointerUp = (event) => {
      const drag = dragRef.current
      dragRef.current = null
      canvas.releasePointerCapture?.(event.pointerId)
      if (drag && drag.moved) return
      const node = hitTest(event.clientX, event.clientY)
      setSelectedId(node ? node.id : null)
    }
    const onPointerLeave = () => {
      hoverRef.current = null
      setHoverId(null)
      setHoverNode(null)
      dragRef.current = null
    }
    const onWheel = (event) => {
      event.preventDefault()
      const next = viewRef.current.zoom * Math.exp(-event.deltaY * 0.0012)
      viewRef.current.zoom = Math.max(0.35, Math.min(3.2, next))
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [hitTest])

  const selectedNode = graph && selectedId ? graph.nodes.find((node) => node.id === selectedId) : null

  const removeMemory = async (kind) => {
    if (!selectedNode || selectedNode.kind !== 'memory') return
    const memoryId = String(selectedNode.id).replace(/^m:/, '')
    setBusy(true)
    try {
      await api(`/${kind}`, { method: 'POST', body: JSON.stringify({ memoryId }) })
      const payload = await api(
        `/graph?limit=400&query=${encodeURIComponent(query)}&topicId=${encodeURIComponent(topicId)}&includeDeleted=${includeDeleted ? '1' : '0'}`,
      )
      setGraph(payload)
      setStats(payload.stats || null)
      setTruncated(Boolean(payload.truncated))
    } catch (err) {
      setError(String(err && err.message ? err.message : err))
    } finally {
      setBusy(false)
    }
  }

  const degraded = diag.nodes > 0 && (!diag.ctx || diag.w < 40 || diag.h < 40)
  const memoryNodes = graph ? graph.nodes.filter((node) => node.kind === 'memory') : []

  return h(
    'div',
    {
      style: {
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 380,
        borderRadius: 10,
        overflow: 'hidden',
        background: 'radial-gradient(ellipse at 50% 42%, rgba(80,130,255,0.10), transparent 62%)',
        border: '1px solid rgba(127,127,127,.16)',
      },
    },
    h('canvas', {
      ref: canvasRef,
      style: { display: 'block', width: '100%', height: '100%', cursor: hoverId ? 'pointer' : 'grab', touchAction: 'none' },
    }),
    h(
      'div',
      { style: { position: 'absolute', left: 10, top: 8, right: 10, display: 'flex', justifyContent: 'space-between', pointerEvents: 'none', fontSize: 11, opacity: 0.7 } },
      h(
        'span',
        null,
        stats
          ? `${stats.memories} 条记忆 · ${stats.entities} 个实体 · ${stats.topics} 个主题`
          : loading
            ? '加载中…'
            : '暂无数据',
      ),
      h(
        'span',
        null,
        truncated
          ? '数据已截断（最多 400 条）'
          : `${degraded ? '画布降级 · ' : ''}节点 ${diag.nodes} · 边 ${diag.links} · 画布 ${diag.w}×${diag.h}${diag.ctx ? '' : ' · 无2D'}`,
      ),
    ),
    degraded
      ? h(
          'div',
          {
            style: {
              position: 'absolute',
              left: 10,
              right: 10,
              top: 34,
              bottom: 10,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            },
          },
          h('div', { style: { fontSize: 11, opacity: 0.7 } }, '画布不可用，已回退为节点列表：'),
          memoryNodes.slice(0, 80).map((node) =>
            h(
              'button',
              {
                key: node.id,
                style: {
                  ...styles.button,
                  textAlign: 'left',
                  whiteSpace: 'normal',
                  lineHeight: 1.4,
                  ...(node.id === selectedId ? styles.chipActive : null),
                },
                onClick: () => setSelectedId(node.id),
              },
              `${node.topicId} · ${String(node.content || '').slice(0, 80)}`,
            ),
          ),
        )
      : null,
    error ? h('div', { style: { ...styles.error, position: 'absolute', left: 10, right: 10, bottom: 10 } }, error) : null,
    selectedNode && selectedNode.kind === 'memory'
      ? h(
          'div',
          {
            style: {
              position: 'absolute',
              right: 10,
              bottom: 10,
              width: 'min(320px, 78%)',
              maxHeight: '62%',
              overflowY: 'auto',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.28))',
              background: 'var(--dsw-alias-bg-elevated, rgba(20,24,32,0.92))',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            },
          },
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 } },
            h('span', { style: { fontSize: 12, opacity: 0.7 } }, `${selectedNode.topicId} · ${selectedNode.status}`),
            h('button', { style: { ...styles.button, padding: '2px 8px' }, onClick: () => setSelectedId(null) }, '关闭'),
          ),
          h('div', { style: { fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, selectedNode.content),
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, opacity: 0.65 } },
            h('span', null, `${selectedNode.entity} · ${selectedNode.attribute}`),
            h('span', null, formatTime(selectedNode.updatedAt)),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
            selectedNode.status === 'TOMBSTONED'
              ? h('button', { style: { ...styles.button, ...styles.buttonDanger }, disabled: busy, onClick: () => removeMemory('purge') }, '彻底删除')
              : h('button', { style: styles.button, disabled: busy, onClick: () => removeMemory('forget') }, '删除'),
          ),
        )
      : null,
    hoverNode && (!selectedNode || hoverNode.id !== selectedNode.id)
      ? h(
          'div',
          {
            style: {
              position: 'absolute',
              left: 12,
              bottom: 12,
              maxWidth: '72%',
              padding: '6px 9px',
              borderRadius: 8,
              fontSize: 11,
              background: 'rgba(15,18,24,0.72)',
              color: 'rgba(226,232,240,0.9)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
          },
          hoverNode.kind === 'memory' ? String(hoverNode.content || '').slice(0, 90) : `${hoverNode.kind === 'entity' ? '实体' : '主题'}：${hoverNode.label}`,
        )
      : null,
  )
}

/** 右侧栏 tab 类型的实现标识（同时用作 body/title 插槽的 key）。 */
const PANE_ID = 'dsh-memory-plugin.memory'
/** 右侧栏 tab 的 kind（openTab 用它打开）。 */
const PANE_KIND = 'memory'

/** 记忆图标（右侧栏 guide 卡片与 tab 标题共用）。 */
function MemoryIcon(props) {
  return h(
    'svg',
    {
      width: props?.size ?? 16,
      height: props?.size ?? 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    h('path', { d: 'M12 3a6 6 0 0 0-6 6v3.5L4.5 15a1 1 0 0 0 .9 1.5h2.1a4.5 4.5 0 0 0 9 0h2.1a1 1 0 0 0 .9-1.5L18 12.5V9a6 6 0 0 0-6-6Z' }),
    h('path', { d: 'M9.5 18.5h5' }),
  )
}

/** 右侧栏 tab 的标题（图标 + 文案）。 */
function MemoryPaneTitle() {
  return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, h(MemoryIcon, { size: 14 }), '记忆')
}

/** 右侧栏 tab 主体：直接复用记忆管理页，只是去掉设置页的外层间距。 */
function MemoryPaneBody(props) {
  return h(MemorySection, { ...props, variant: 'pane' })
}

/** 插件显示名（Loader 会忽略，仅供调试）。 */
const name = 'dsh-memory-plugin'
/** 只声明必需服务；sidebarRightTabs 用 ctx.inject 延迟获取，缺席时不拖垮插件。 */
const inject = ['slots']

function warn(event, error) {
  try {
    console.warn(`[dsh-memory] ${event}`, error)
  } catch {
    // ignore
  }
}

/** 右侧栏 tab：类型 + body + title 三件套。 */
function registerMemoryPane(scope) {
  scope.effect(() =>
    scope.sidebarRightTabs.register({
      id: PANE_ID,
      kind: PANE_KIND,
      priority: 'extension',
      multiple: false,
      keepMounted: true,
      title: () => '记忆',
      guide: [
        {
          id: 'memory',
          order: 45,
          title: () => '记忆',
          description: () => '查看长期记忆',
          icon: MemoryIcon,
        },
      ],
    }),
  )

  scope.effect(() =>
    scope.slots.inject('sidebar.right.pane.tab', () =>
      scope.slots.register(
        {
          name: 'sidebar.right.pane.tab',
          key: PANE_ID,
        },
        MemoryPaneBody,
      ),
    ),
  )

  scope.effect(() =>
    scope.slots.inject('sidebar.right.pane.tab.title', () =>
      scope.slots.register(
        {
          name: 'sidebar.right.pane.tab.title',
          key: PANE_ID,
        },
        MemoryPaneTitle,
      ),
    ),
  )
}

function apply(ctx) {
  // 1) 设置 → 记忆（与壁纸插件同一套入口）
  try {
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
  } catch (error) {
    warn('settings section registration failed', error)
  }

  // 2) 右侧栏 tab（文件 / 浏览器 / 终端那一列）。服务缺席时安静跳过。
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['sidebarRightTabs'], (scope) => {
        try {
          registerMemoryPane(scope)
        } catch (error) {
          warn('right-sidebar tab registration failed', error)
        }
      })
    }
  } catch (error) {
    warn('right-sidebar service unavailable', error)
  }
}

/** 仅用于构建/沙箱自测的纯函数（Loader 不使用）。 */
const __debug = { buildLayout, stepLayout, projectLayout, drawScene }

export { name, inject, apply, __debug }
