import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

function findRoot(start: string): string {
  let current = resolve(start)
  while (!existsSync(join(current, 'package.json'))) {
    const parent = dirname(current)
    if (parent === current) throw new Error('无法定位项目根目录')
    current = parent
  }
  return current
}

const root = findRoot(dirname(fileURLToPath(import.meta.url)))
const sourceDir = join(root, 'src', 'lib', 'client')
const outputFile = join(root, 'lib', 'client.js')

const BODY_ORDER = [
  'data/settings-dicts.ts',
  'logic/settings-store.ts',
  'logic/prompt-store.ts',
  'data/terms.ts',
  'data/zh-dict.ts',
  'data/dom-labels.ts',
  'data/traj-patterns.ts',
  'logic/format-utils.ts',
  'logic/settings-section.ts',
  'logic/auto-archive.ts',
  'logic/session-menu.ts',
  'logic/archive-view.ts',
  'logic/service-monitor.ts',
  'logic/register.ts',
  'logic/dom-enhance.ts',
  'logic/apply.ts',
]

const compilerOptions: ts.TranspileOptions['compilerOptions'] = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.None,
  newLine: ts.NewLineKind.LineFeed,
  removeComments: false,
  sourceMap: false,
}

function transpileFragment(content: string, fileName: string): string {
  const result = ts.transpileModule(content, {
    fileName,
    reportDiagnostics: true,
    compilerOptions,
  })
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  if (errors.length > 0) {
    const message = ts.flattenDiagnosticMessageText(errors[0].messageText, '\n')
    throw new Error(`客户端 TypeScript 片段无法转译（${fileName}）: ${message}`)
  }
  return result.outputText.replace(/\r\n/g, '\n')
}

const banner = readFileSync(join(sourceDir, 'entry.ts'), 'utf8').replace(/\r\n/g, '\n').trim()
const wrapperStart = `window.__ModuleLoader__.load({
  id: 'deepseek-harness-zh_pro',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');`
const wrapperEnd = `    exports.inject = ['locale', 'slots'];
    exports.apply = apply;
    exports.settingsStore = settingsStore;
    return module.exports;
  },
});`

const body = BODY_ORDER.map((relativePath) => {
  const path = join(sourceDir, relativePath)
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim()
}).join('\n\n')
const source = [banner, wrapperStart, body, wrapperEnd].join('\n\n') + '\n'
const output = transpileFragment(source, 'deepseek-harness-zh_pro-client.ts')

if (!output.includes("window.__ModuleLoader__.load({")) {
  throw new Error('客户端构建产物缺少 __ModuleLoader__ 注册入口')
}
if (/\b(?:import|export)\s+(?:[A-Za-z{*]|default)\b/.test(output)) {
  throw new Error('客户端构建产物意外包含 ESM import/export')
}
writeFileSync(outputFile, output)

// 保留旧版拆分路径作为可审查的生成快照，避免已有开发工具或缓存引用失效。
for (const relativePath of BODY_ORDER) {
  const sourcePath = join(sourceDir, relativePath)
  const targetPath = join(root, 'lib', 'client', relativePath.replace(/\.ts$/, '.js'))
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, transpileFragment(readFileSync(sourcePath, 'utf8'), relativePath))
}
writeFileSync(join(root, 'lib', 'client', 'entry.js'), `${banner}\n`)
writeFileSync(join(root, 'lib', 'client', 'footer.js'), '/** 客户端工厂尾部由构建器生成。 */\n')

console.log(`已生成 ${outputFile}（${output.split('\n').length} 行）`)
