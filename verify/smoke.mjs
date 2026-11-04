#!/usr/bin/env node
/**
 * smoke.mjs — 端到端冒烟测试，不需要 DSH 的私有校验代码
 *
 * 覆盖这条路：导出 JSON → 导入 → 会话日志结构正确 → 之后追加 system/message 仍合法
 * （最后一步正是 0.1.0 漏掉的那个坑）
 *
 * 用法：node verify/smoke.mjs [fixture.json]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const fixture = path.resolve(process.argv[2] || 'samples/fixture-references.json');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-smoke-'));
const home = path.join(root, 'home');
const workspace = path.join(root, 'workspace');
const store = path.join(home, 'storages', 'workspace.json');

fs.mkdirSync(path.join(home, 'storages'), { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(
  store,
  JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      defaultWorkspaceId: 'ws',
      workspaceIds: ['ws'],
      archivedSessionIds: [],
      pinnedSessionIds: [],
    },
    tables: {
      workspaces: {
        ws: { path: workspace, title: 'smoke', sessionIds: [], updatedAt: new Date().toISOString() },
      },
    },
  }),
  'utf8'
);

process.env.DSH_HOME = home;

const { runImport } = await import('../dsh-import.mjs');
const result = await runImport({ files: [fixture], workspacePath: workspace });
if (!result?.created?.length) {
  console.error('FAIL  导入没有产出会话');
  process.exit(1);
}

const id = result.created[0].sessionId || result.created[0];
const sessionsRoot = path.join(home, 'sessions');
const projectDir = fs.readdirSync(sessionsRoot).find((name) => name.startsWith('--'));
const file = path.join(sessionsRoot, projectDir, id, 'session.v4.jsonl.zstd');
if (!fs.existsSync(file)) {
  console.error(`FAIL  找不到会话日志：${file}`);
  process.exit(1);
}

// ---- 解析多帧 zstd ----
const buf = fs.readFileSync(file);
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const offsets = [];
for (let i = -1; (i = buf.indexOf(magic, i + 1)) !== -1;) offsets.push(i);
const frames = [];
for (let k = 0; k < offsets.length; k++) {
  frames.push(zlib.zstdDecompressSync(buf.subarray(offsets[k], offsets[k + 1] ?? buf.length)).toString('utf8'));
}

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

check('第一帧只有 header 一行', frames[0].trimEnd().split('\n').length === 1);

const rows = frames.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const header = rows[0];
const events = rows.slice(1);

check('每条记录一帧', frames.length === rows.length);
check('seq 连续', events.every((event, index) => event.seq === index));
check('有 user/message', events.some((e) => e.type === 'user/message'));

const systems = events.filter((e) => e.type === 'system/message');
check('system 头恰好一条', systems.length === 1, `实际 ${systems.length}`);

const surfaceTypes = new Set(['system/message', 'user/message', 'assistant/message', 'developer/message', 'tool/result']);
const firstSurface = events.find((e) => surfaceTypes.has(e.type));
check('system 是 surface 的第一个节点', firstSurface?.type === 'system/message', `实际 ${firstSurface?.type}`);

// ---- 模拟「导入后继续对话」：追加一条新的 system/message ----
const lastTurn = events.reduce((max, e) => (typeof e.data?.turn === 'number' ? Math.max(max, e.data.turn) : max), 0);
const appended = [
  ...events,
  { type: 'turn/start', seq: events.length, time: Date.now(), data: { turn: lastTurn + 1 } },
  { type: 'step/start', seq: events.length + 1, time: Date.now(), data: { turn: lastTurn + 1, step: 1 } },
  {
    type: 'system/message',
    seq: events.length + 2,
    time: Date.now(),
    data: {
      turn: lastTurn + 1,
      step: 1,
      message: {
        role: 'system',
        content: [{ type: 'text', text: '后续轮次' }],
        source: { kind: 'system-prompt' },
        id: 'smoke',
      },
    },
    surfaceOp: 'append',
  },
];

// 复刻 v4 的不变量：surface 非空时，system/message 必须已有受保护的头
const surface = [];
let protectedHead;
for (const event of appended) {
  if (event.surfaceOp !== 'append') continue;
  if (event.type === 'system/message' && surface.length > 0 && protectedHead === undefined) {
    check('追加 system/message 不破坏不变量', false, 'protected head 未定义');
    break;
  }
  if (event.type === 'system/message' && surface.length === 0) protectedHead = event.seq;
  if (surfaceTypes.has(event.type)) surface.push(event.seq);
}
if (!checks.some((c) => c.name === '追加 system/message 不破坏不变量')) {
  check('追加 system/message 不破坏不变量', true);
}

// ---- 旁挂文件 ----
const sidecar = path.join(workspace, '.dsh-imported', id);
check('生成了 .dsh-imported 目录', fs.existsSync(sidecar));

console.log(`fixture: ${path.relative(process.cwd(), fixture)}`);
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` (${item.detail})` : ''}`);
}

fs.rmSync(root, { recursive: true, force: true });

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error(`\n${failed.length} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
