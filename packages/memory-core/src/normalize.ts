import { createHash } from 'node:crypto'
import type { Modality, Polarity } from '@dsh-memory/ports'

/** 文本归一化：NFKC、去首尾空白、折叠空白、小写（对中文无副作用） */
export function normalizeText(input: string): string {
  return input.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 实体归一化：与 normalizeText 一致，保留用于将来扩展别名映射 */
export function normalizeEntity(input: string): string {
  return normalizeText(input)
}

/** 值归一化：去尾标点，便于判等 */
export function normalizeValue(input: string): string {
  return normalizeText(input).replace(/[。.!！?？,，;；:：]+$/u, '')
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function shortHash(input: string): string {
  return sha256(input).slice(0, 16)
}

const SEP = '\u001f'

export function factKeyOf(topicId: string, entity: string, attribute: string): string {
  return [topicId, normalizeEntity(entity), normalizeText(attribute)].join(SEP)
}

export function valueHashOf(value: string): string {
  return shortHash(normalizeValue(value))
}

function sortedObject(input: Record<string, string> | undefined): Array<[string, string]> {
  if (!input) return []
  return Object.entries(input)
    .map(([k, v]) => [normalizeText(k), normalizeText(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

export function contextHashOf(
  conditions: Record<string, string> | undefined,
  exceptions: string[] | undefined,
  modality: Modality,
  polarity: Polarity,
): string {
  const payload = {
    c: sortedObject(conditions),
    e: [...(exceptions ?? [])].map(normalizeText).sort(),
    m: modality,
    p: polarity,
  }
  return shortHash(JSON.stringify(payload))
}
