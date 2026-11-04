import { describe, expect, it } from 'vitest'
import { createDshLlmPort, type DshStreamChunk } from '../src/llm.js'

function streamOf(chunks: DshStreamChunk[]) {
  return {
    async *stream() {
      for (const chunk of chunks) yield chunk
    },
  }
}

describe('DshLlmPort：流式分片组装', () => {
  it('拼接 text-delta，忽略其他分片', async () => {
    const port = createDshLlmPort(
      streamOf([
        { type: 'block-start', index: 0 },
        { type: 'text-delta', index: 0, text: '你' },
        { type: 'text-delta', index: 0, text: '好' },
        { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } },
        { type: 'finish', reason: { kind: 'stop' } },
      ]),
      { provider: 'p', model: 'm' },
    )
    await expect(port.complete({ prompt: 'hi' })).resolves.toBe('你好')
    expect(port.lastUsage()).toEqual({ inputTokens: 1, outputTokens: 2 })
  })

  it('非 stop 的 finish 抛错', async () => {
    const port = createDshLlmPort(
      streamOf([{ type: 'text-delta', index: 0, text: 'x' }, { type: 'finish', reason: { kind: 'error' } }]),
      { provider: 'p', model: 'm' },
    )
    await expect(port.complete({ prompt: 'hi' })).rejects.toThrow('llm finish: error')
  })

  it('空文本抛错（fail-open 由调用方处理）', async () => {
    const port = createDshLlmPort(streamOf([{ type: 'finish', reason: { kind: 'stop' } }]), {
      provider: 'p',
      model: 'm',
    })
    await expect(port.complete({ prompt: 'hi' })).rejects.toThrow('empty text')
  })
})
