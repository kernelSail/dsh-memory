import { build } from 'esbuild'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgLib = join(here, 'pkg/lib')
mkdirSync(pkgLib, { recursive: true })

// 1) 宿主入口：单文件 ESM
await build({
  entryPoints: [join(here, 'entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: join(here, 'dist/index.js'),
  logLevel: 'warning',
})
copyFileSync(join(here, 'dist/index.js'), join(pkgLib, 'index.js'))

// 2) 浏览器入口：CJS 打包后包成 DSH 的 __ModuleLoader__ 工厂
const clientResult = await build({
  entryPoints: [join(here, 'client.js')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react', 'react/jsx-runtime'],
  write: false,
  logLevel: 'warning',
})
const body = clientResult.outputFiles[0].text
const wrapped = [
  `window.__ModuleLoader__.load({ id: 'dsh-memory-plugin', factory: (require) => {`,
  body,
  `return module.exports;`,
  `} });`,
  '',
].join('\n')
writeFileSync(join(pkgLib, 'client.js'), wrapped, 'utf8')

console.log('built pkg/lib/index.js (host) and pkg/lib/client.js (browser)')
