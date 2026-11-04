import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  write: false,
  logLevel: 'warning',
})
const body = clientResult.outputFiles[0].text
const wrapped = [
  `window.__ModuleLoader__.load({ id: 'dsh-memory-plugin', factory: (require) => {`,
  // DSH 的 factory 作用域里没有 Node 的 module/exports，必须自己声明，
  // 否则打包产物里的 `module.exports = ...` 会在浏览器里抛 module is not defined。
  `var module = { exports: {} };`,
  `var exports = module.exports;`,
  body,
  `return module.exports;`,
  `} });`,
  '',
].join('\n')
writeFileSync(join(pkgLib, 'client.js'), wrapped, 'utf8')

// 防回归：DSH 的 factory 作用域没有 module/exports，缺了它 web boot 会
// 报 "dsh-memory-plugin: import failed: module is not defined" 并触发恢复流程。
const emitted = readFileSync(join(pkgLib, 'client.js'), 'utf8')
if (!emitted.includes('var module = { exports: {} };')) {
  throw new Error('client wrapper is missing the module shim; web boot would fail with "module is not defined"')
}
if (!emitted.includes('window.__ModuleLoader__.load(')) {
  throw new Error('client wrapper is missing the __ModuleLoader__ envelope')
}

console.log('built pkg/lib/index.js (host) and pkg/lib/client.js (browser)')
