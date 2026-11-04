import { describe, expect, it } from 'vitest'
import type { LLMPort } from '@dsh-memory/ports'
import { buildExtractPrompt, extractCandidates, parseCandidates } from '../src/extract.js'

const input = {
  messages: [
    { role: 'user', content: '权限模型用 RBAC，用户可加入多个组织' },
    { role: 'assistant', content: '收到' },
  ],
  defaultTopicId: 't1',
}

describe('extract：候选提取', () => {
  it('prompt 包含对话与 JSON 契约', () => {
    const prompt = buildExtractPrompt(input)
    expect(prompt).toContain('权限模型用 RBAC')
    expect(prompt).toContain('"candidates"')
  })

  it('解析合法 JSON，过滤缺字段条目，默认 topic', () => {
    const raw = JSON.stringify({
      candidates: [
        { entity: 'perm_model', attribute: 'type', value: 'rbac', content: '权限模型采用 RBAC' },
        { entity: '', attribute: 'x', value: 'y' },
        { entity: 'user_org', attribute: 'membership', value: 'multi', modality: 'weird' },
      ],
    })
    const candidates = parseCandidates(raw, input)
    expect(candidates).toHaveLength(2)
    expect(candidates[0]?.topicId).toBe('t1')
    expect(candidates[1]?.modality).toBe('asserted')
  })

  it('非法 JSON / 空输出返回空数组', () => {
    expect(parseCandidates('not json', input)).toEqual([])
    expect(parseCandidates('', input)).toEqual([])
  })

  it('extractCandidates 调用 LLM 并收敛结果', async () => {
    const llm: LLMPort = {
      async complete<T>() {
        return JSON.stringify({
          candidates: [{ entity: 'perm_model', attribute: 'type', value: 'rbac', content: '权限模型采用 RBAC' }],
        }) as T
      },
    }
    const candidates = await extractCandidates(input, { llm })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.sourceSpeaker).toBe('user')
    expect(candidates[0]?.sourceRefs).toEqual([])
  })

  it('LLM 抛错时 fail-open 返回空数组', async () => {
    const llm: LLMPort = {
      async complete() {
        throw new Error('timeout')
      },
    }
    expect(await extractCandidates(input, { llm })).toEqual([])
  })

  it('保留模型给出的主题并规范化 slug', () => {
    const raw = JSON.stringify({
      candidates: [{ topicId: 'Project Architecture', entity: 'db', attribute: 'engine', value: 'pg' }],
    })
    const candidates = parseCandidates(raw, input)
    expect(candidates[0]?.topicId).toBe('project_architecture')
  })

  it('解析 validFrom / validUntil 为 ISO', () => {
    const raw = JSON.stringify({
      candidates: [
        {
          topicId: 't1',
          entity: 'perm',
          attribute: 'type',
          value: 'abac',
          validFrom: '2026-01-01',
          validUntil: '2026-12-31',
        },
      ],
    })
    const candidate = parseCandidates(raw, input)[0]
    expect(candidate?.validFrom).toBe('2026-01-01T00:00:00.000Z')
    expect(candidate?.validUntil).toBe('2026-12-31T00:00:00.000Z')
  })

  it('已知主题出现在 prompt 中', () => {
    const prompt = buildExtractPrompt({ messages: [], topicHints: ['alpha', 'beta'] })
    expect(prompt).toContain('alpha, beta')
  })
})
