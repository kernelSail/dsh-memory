import { describe, expect, it } from 'vitest'
import { createStorage } from '@dsh-memory/storage-sqlite'
import { ingestCandidate } from '@dsh-memory/core'
import { registerMemoryApi } from '../plugin-build/http.js'

const clock = { now: () => new Date('2026-11-04T00:00:00.000Z') }

interface Captured {
  statusCode?: number
  headers: Record<string, string>
  body: string
}

function makeRes(): { res: any; captured: Captured } {
  const captured: Captured = { headers: {}, body: '' }
  const res = {
    set statusCode(value: number) {
      captured.statusCode = value
    },
    get statusCode() {
      return captured.statusCode ?? 0
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value
    },
    end(chunk?: string) {
      captured.body = chunk ?? ''
    },
  }
  return { res, captured }
}

function makeReq(path: string, method = 'GET', body?: unknown): any {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    url: path,
    method,
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of payload) yield chunk
    },
  }
}

function setup() {
  const storage = createStorage()
  ingestCandidate(
    { topicId: 't1', entity: 'perm', attribute: 'type', value: 'rbac', content: '权限模型是 RBAC' },
    { storage, clock },
  )
  const routes = new Map<string, (req: any, res: any) => unknown>()
  const ctx = {
    reflect: { get: (name: string) => (name === 'webServer' ? { register: (entry: any) => routes.set(entry.path, entry.handler) } : undefined) },
  }
  const ok = registerMemoryApi(ctx, { storage, config: { tenantId: 'default' } } as any, () => {})
  return { storage, routes, ok }
}

describe('插件前端接口', () => {
  it('注册 stats / list / forget / purge / export 路由', () => {
    const { routes, ok, storage } = setup()
    expect(ok).toBe(true)
    for (const path of ['/plugins/dsh-memory/stats', '/plugins/dsh-memory/list', '/plugins/dsh-memory/forget', '/plugins/dsh-memory/purge', '/plugins/dsh-memory/export']) {
      expect(routes.has(path)).toBe(true)
    }
    storage.close()
  })

  it('stats 返回总数与主题', async () => {
    const { routes, storage } = setup()
    const { res, captured } = makeRes()
    await routes.get('/plugins/dsh-memory/stats')!(makeReq('/plugins/dsh-memory/stats'), res)
    const body = JSON.parse(captured.body)
    expect(captured.statusCode).toBe(200)
    expect(body.total).toBe(1)
    expect(body.active).toBe(1)
    expect(body.topics[0]).toEqual({ topicId: 't1', count: 1 })
    storage.close()
  })

  it('list 支持关键词检索', async () => {
    const { routes, storage } = setup()
    const { res, captured } = makeRes()
    await routes.get('/plugins/dsh-memory/list')!(makeReq('/plugins/dsh-memory/list?query=RBAC'), res)
    const body = JSON.parse(captured.body)
    expect(body.count).toBe(1)
    expect(body.memories[0].content).toContain('RBAC')
    storage.close()
  })

  it('forget 将记忆置为墓碑', async () => {
    const { routes, storage } = setup()
    const id = storage.listMemories('default')[0]!.id
    const { res, captured } = makeRes()
    await routes.get('/plugins/dsh-memory/forget')!(makeReq('/plugins/dsh-memory/forget', 'POST', { memoryId: id }), res)
    expect(captured.statusCode).toBe(200)
    expect(JSON.parse(captured.body).deleted).toBe(true)
    expect(storage.getMemory(id)?.status).toBe('TOMBSTONED')
    storage.close()
  })

  it('非 loopback 请求被拒绝', async () => {
    const { routes, storage } = setup()
    const { res, captured } = makeRes()
    const req = makeReq('/plugins/dsh-memory/stats')
    req.socket.remoteAddress = '10.0.0.8'
    await routes.get('/plugins/dsh-memory/stats')!(req, res)
    expect(captured.statusCode).toBe(403)
    storage.close()
  })

  it('graph 返回记忆/实体/主题节点与连边', async () => {
    const { routes, storage } = setup()
    const { res, captured } = makeRes()
    await routes.get('/plugins/dsh-memory/graph')!(makeReq('/plugins/dsh-memory/graph'), res)
    const graph = JSON.parse(captured.body)
    expect(captured.statusCode).toBe(200)
    const kinds = graph.nodes.map((node: { kind: string }) => node.kind)
    expect(kinds).toContain('memory')
    expect(kinds).toContain('entity')
    expect(kinds).toContain('topic')
    const linkKinds = graph.links.map((link: { kind: string }) => link.kind)
    expect(linkKinds).toContain('entity')
    expect(linkKinds).toContain('topic')
    expect(graph.stats.memories).toBe(1)
    storage.close()
  })

  it('graph 搜索命中时给节点打 matched', async () => {
    const { routes, storage } = setup()
    const { res, captured } = makeRes()
    await routes.get('/plugins/dsh-memory/graph')!(makeReq('/plugins/dsh-memory/graph?query=RBAC'), res)
    const graph = JSON.parse(captured.body)
    const memoryNode = graph.nodes.find((node: { kind: string }) => node.kind === 'memory')
    expect(memoryNode.matched).toBe(true)
    storage.close()
  })
})
