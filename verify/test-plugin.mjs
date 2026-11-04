#!/usr/bin/env node
/**
 * test-plugin.mjs — 校验 Host 插件入口的形状
 *
 * 不依赖真实的 DSH 运行时：给 @deepseek-ai/dsh-tools 放一个最小替身，
 * 检查 apply() 确实注册了 import_deepseek_chat，参数与输出契约完整。
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const stubDir = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-tools');
fs.mkdirSync(stubDir, { recursive: true });
fs.writeFileSync(
  path.join(stubDir, 'package.json'),
  JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.0.0-test', type: 'module', main: 'index.js' }),
  'utf8'
);
fs.writeFileSync(
  path.join(stubDir, 'index.js'),
  'export function defineTool(options) { return { ...options, __tool: true }; }\n',
  'utf8'
);

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const mod = await import(new URL('../index.js', import.meta.url).href);
check('导出 name', typeof mod.name === 'string' && mod.name.length > 0);
check('导出 inject 含 tools', Array.isArray(mod.inject) && mod.inject.includes('tools'));
check('导出 apply 函数', typeof mod.apply === 'function');

const registered = [];
const ctx = { tools: { register: (tool) => registered.push(tool) } };
await mod.apply(ctx, {});

check('注册了一个工具', registered.length === 1, `实际 ${registered.length}`);
const tool = registered[0] || {};
check('工具名 import_deepseek_chat', tool.name === 'import_deepseek_chat');
check('声明了 file 参数', Boolean(tool.parameters?.file || tool.parameters?.properties?.file));
check('有 execute', typeof tool.execute === 'function');
check('输出 schema 含 created', Boolean(tool.output?.schema?.properties?.created));

// 包清单：插件入口必须被打进包里
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check('package.json 声明 dsh.bundle.patch', pkg.dsh?.bundle?.patch === './cordis.patch.yml');
check('exports 指向 index.js', pkg.exports?.['.'] === './index.js');
check('files 含 index.js', (pkg.files || []).includes('index.js'));
check('files 含 cordis.patch.yml', (pkg.files || []).includes('cordis.patch.yml'));
check('files 含 locale', (pkg.files || []).some((f) => f.startsWith('locale/')));
check('files 含 icon', (pkg.files || []).includes('icon.svg'));

for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` (${item.detail})` : ''}`);
}

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error(`\n${failed.length} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
