/** token 估算：ceil(chars / 3.5)，可被 TokenizerPort 替换（附录 B） */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}
