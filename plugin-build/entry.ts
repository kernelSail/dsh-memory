/**
 * DSH 插件入口（打包用）。
 *
 * 目的：把 memory-adapter-dsh + core + storage 打成单文件 ESM，
 * 加载进 DSH profile 的 node_modules 做真实宿主冒烟验证。
 *
 * apply 先写加载标记，再动态 import 适配器：
 * 即使 node:sqlite 在 Electron 内不可用，也能从标记看出卡在哪一步。
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerMemoryApi } from './http.ts'

const MARKER = join(process.env.USERPROFILE ?? '.', '.dsh', 'memory-plugin-load.json')
const DEBUG = join(process.env.USERPROFILE ?? '.', '.dsh', 'memory-plugin-debug.log')

function debug(event: string, payload: Record<string, unknown> = {}): void {
  try {
    appendFileSync(DEBUG, JSON.stringify({ at: new Date().toISOString(), event, ...payload }) + '\n')
  } catch {
    // ignore
  }
}

function writeMarker(payload: Record<string, unknown>): void {
  try {
    mkdirSync(join(process.env.USERPROFILE ?? '.', '.dsh'), { recursive: true })
    writeFileSync(
      MARKER,
      JSON.stringify({ at: new Date().toISOString(), node: process.version, ...payload }, null, 2),
      'utf8',
    )
  } catch {
    // 标记失败不影响插件
  }
}

export const name = 'dsh-memory'
// cordis 只在注入的服务就绪后才激活插件
export const inject = ['llm', 'systemPrompt', 'tools']

export async function apply(ctx: any, config: any = {}): Promise<unknown> {
  // cordis 不允许未声明 inject 就访问服务；用 reflect.get 做可选读取
  const get = (name: string): any => {
    try {
      return typeof ctx?.reflect?.get === 'function' ? ctx.reflect.get(name, false) : undefined
    } catch {
      return undefined
    }
  }

  const view = {
    llm: get('llm'),
    systemPrompt: get('systemPrompt'),
    tools: get('tools'),
    on: typeof ctx?.on === 'function' ? ctx.on.bind(ctx) : undefined,
    logger: { warn: (message: string) => debug('warn', { message }) },
  }

  debug('apply', { services: { llm: !!view.llm, systemPrompt: !!view.systemPrompt, tools: !!view.tools } })
  try {
    ctx.on?.('session/event', (...args: any[]) => {
      const event = args[1] as any
      let sample = ''
      try {
        sample = JSON.stringify(event?.data ?? null).slice(0, 300)
      } catch {
        sample = 'unserializable'
      }
      debug('session/event', { type: String(event?.type), data: sample })
    })
    const sessions = get('sessions')
    if (sessions?.on) {
      sessions.on('event', (...args: any[]) => debug('sessions/event', { argc: args.length, sample: String(args?.[0]?.type) }))
    }
  } catch (error) {
    debug('subscribe-failed', { error: String(error) })
  }

  const services = {
    llm: typeof view.llm?.stream === 'function',
    systemPrompt: typeof view.systemPrompt?.section === 'function',
    tools: typeof view.tools?.register === 'function',
    on: typeof view.on === 'function',
  }
  writeMarker({ phase: 'apply-called', services })

  try {
    const mod = await import('../packages/memory-adapter-dsh/src/index.ts')
    const plugin = mod.apply(view as any, { ...mod.defaultConfig, ...(config ?? {}) })
    // 前端页面所需的数据接口（stats / list / forget / purge / export）
    let http = false
    try {
      http = registerMemoryApi(ctx, plugin as any, debug)
    } catch (error) {
      debug('http-register-failed', { error: String(error) })
    }
    writeMarker({ phase: 'loaded', ok: true, services, http, config: plugin?.config ?? null })
    // cordis apply 的返回值必须是 effect（dispose 函数）或 undefined。
    // 返回异步 dispose：宿主关停时会等待在途提取/写入，headless 一次性运行才不丢数据。
    return async () => {
      debug('dispose-start')
      try {
        await plugin?.flush()
        debug('dispose-flush-done')
      } finally {
        plugin?.dispose()
        debug('dispose-done')
      }
    }
  } catch (error) {
    writeMarker({
      phase: 'failed',
      ok: false,
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw error
  }
}
