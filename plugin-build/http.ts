/**
 * 记忆插件的宿主 HTTP 接口（供插件前端页面读取/删除记忆）。
 *
 * 路由挂在 DSH 的 webServer 上，路径前缀 /plugins/dsh-memory/。
 * 只用 loopback 连接（页面与宿主同源），不额外引入鉴权。
 */
import { exportNdjson, forgetMemory, purgeMemory } from '@dsh-memory/core'

interface WebServerLike {
  register(entry: {
    kind: 'exact'
    path: string
    handler: (req: any, res: any) => void | Promise<void>
  }): unknown
}

interface PluginLike {
  storage: any
  config?: { tenantId?: string }
}

function json(res: any, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader?.('content-type', 'application/json; charset=utf-8')
  res.setHeader?.('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function text(res: any, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.statusCode = status
  res.setHeader?.('content-type', contentType)
  res.setHeader?.('cache-control', 'no-store')
  res.end(body)
}

function urlOf(req: any): URL {
  return new URL(String(req?.url ?? '/'), 'http://127.0.0.1')
}

async function bodyOf(req: any): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > 1_000_000) throw new Error('body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function isLoopback(req: any): boolean {
  const address = String(req?.socket?.remoteAddress ?? '')
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

function memoryView(memory: any): Record<string, unknown> {
  return {
    memoryId: memory.id,
    topicId: memory.topicId,
    entity: memory.entity,
    attribute: memory.attribute,
    value: memory.value,
    content: memory.content,
    status: memory.status,
    modality: memory.modality,
    polarity: memory.polarity,
    confidence: memory.confidence,
    importance: memory.importance,
    factKey: memory.factKey,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    validFrom: memory.validFrom,
    validUntil: memory.validUntil,
    deletedAt: memory.deletedAt,
  }
}

export function registerMemoryApi(ctx: any, plugin: PluginLike, log: (event: string, payload?: Record<string, unknown>) => void): boolean {
  const webServer = (() => {
    try {
      return typeof ctx?.reflect?.get === 'function' ? ctx.reflect.get('webServer', false) : ctx?.webServer
    } catch {
      return undefined
    }
  })() as WebServerLike | undefined
  if (!webServer || typeof webServer.register !== 'function') {
    log('http-unavailable')
    return false
  }

  const storage = plugin.storage
  const tenantId = plugin.config?.tenantId ?? 'default'
  const clock = { now: () => new Date() }

  webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-memory/stats',
    handler: (req, res) => {
      if (!isLoopback(req)) return json(res, 403, { error: 'loopback only' })
      try {
        const all = storage.listMemories(tenantId) as any[]
        const topics = new Map<string, number>()
        let active = 0
        let tombstoned = 0
        let lastUpdated = ''
        for (const memory of all) {
          if (memory.status === 'ACTIVE') active++
          if (memory.status === 'TOMBSTONED' || memory.deletedAt) tombstoned++
          topics.set(memory.topicId, (topics.get(memory.topicId) ?? 0) + 1)
          if (String(memory.updatedAt) > lastUpdated) lastUpdated = String(memory.updatedAt)
        }
        json(res, 200, {
          total: all.length,
          active,
          tombstoned,
          topics: [...topics.entries()].map(([topicId, count]) => ({ topicId, count })).sort((a, b) => b.count - a.count),
          lastUpdated: lastUpdated || null,
        })
      } catch (error) {
        json(res, 500, { error: String(error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-memory/list',
    handler: (req, res) => {
      if (!isLoopback(req)) return json(res, 403, { error: 'loopback only' })
      try {
        const url = urlOf(req)
        const query = (url.searchParams.get('query') ?? '').trim()
        const topicId = (url.searchParams.get('topicId') ?? '').trim()
        const includeDeleted = url.searchParams.get('includeDeleted') === '1'
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200) || 200, 1), 500)

        let rows: any[]
        if (query) {
          rows = storage.search(query, { ...(topicId ? { topicId } : {}), limit }) as any[]
        } else if (topicId) {
          rows = (storage.listActiveByTopic(topicId) as any[]).slice(0, limit)
        } else {
          rows = (storage.listMemories(tenantId) as any[]).slice(0, limit)
        }
        if (!includeDeleted) rows = rows.filter((memory) => !memory.deletedAt && memory.status !== 'TOMBSTONED')
        rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        json(res, 200, { memories: rows.map(memoryView), count: rows.length })
      } catch (error) {
        json(res, 500, { error: String(error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-memory/forget',
    handler: async (req, res) => {
      if (!isLoopback(req)) return json(res, 403, { error: 'loopback only' })
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      try {
        const body = await bodyOf(req)
        const memoryId = String(body.memoryId ?? '')
        if (!memoryId) return json(res, 400, { error: 'memoryId required' })
        const result = await forgetMemory(memoryId, { storage, clock }, { actor: 'web-ui', reason: '用户在前端页面删除' })
        json(res, 200, { deleted: result.found, memoryId, summaryStale: result.summaryStale })
      } catch (error) {
        json(res, 500, { error: String(error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-memory/purge',
    handler: async (req, res) => {
      if (!isLoopback(req)) return json(res, 403, { error: 'loopback only' })
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      try {
        const body = await bodyOf(req)
        const memoryId = String(body.memoryId ?? '')
        if (!memoryId) return json(res, 400, { error: 'memoryId required' })
        const result = await purgeMemory(
          memoryId,
          { storage, clock },
          { actor: 'web-ui', reason: '用户在前端页面硬删除' },
        )
        json(res, 200, { purged: result.purged, reason: result.reason, memoryId })
      } catch (error) {
        json(res, 400, { error: String(error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-memory/export',
    handler: (req, res) => {
      if (!isLoopback(req)) return json(res, 403, { error: 'loopback only' })
      try {
        text(res, 200, exportNdjson(storage, tenantId), 'application/x-ndjson; charset=utf-8')
      } catch (error) {
        json(res, 500, { error: String(error) })
      }
    },
  })

  log('http-registered')
  return true
}
