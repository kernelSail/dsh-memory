import { describe, expect, it } from 'vitest'
import { ILLEGAL_TRANSITIONS, assertTransition, canTransition } from '../src/state.js'

describe('memory 状态机', () => {
  it('允许合法迁移', () => {
    expect(canTransition('PENDING', 'ACTIVE')).toBe(true)
    expect(canTransition('ACTIVE', 'SUPERSEDED')).toBe(true)
    expect(canTransition('ARCHIVED', 'ACTIVE')).toBe(true)
    expect(canTransition('ACTIVE', 'TOMBSTONED')).toBe(true)
  })

  it('8 条非法迁移全部被拒（§19.6）', () => {
    for (const [from, to] of ILLEGAL_TRANSITIONS) {
      expect(canTransition(from, to)).toBe(false)
      expect(() => assertTransition(from, to)).toThrow(/illegal/)
    }
  })
})
