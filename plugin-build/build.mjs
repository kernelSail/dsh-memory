import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [join(here, 'entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: join(here, 'dist/index.js'),
  logLevel: 'warning',
})

mkdirSync(join(here, 'pkg/lib'), { recursive: true })
copyFileSync(join(here, 'dist/index.js'), join(here, 'pkg/lib/index.js'))
console.log('built dist/index.js and pkg/lib/index.js')
