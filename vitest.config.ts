import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@dsh-memory/ports': r('./packages/memory-ports/src/index.ts'),
      '@dsh-memory/core': r('./packages/memory-core/src/index.ts'),
      '@dsh-memory/storage-sqlite': r('./packages/memory-storage-sqlite/src/index.ts'),
      '@dsh-memory/adapter-dsh': r('./packages/memory-adapter-dsh/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'conformance/**/*.test.ts'],
  },
})
