#!/usr/bin/env node
/**
 * make-handoff.mjs — 生成一个「交接会话」：一条用户消息装着项目简报，上下文极轻
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS = path.join(DSH_HOME, 'sessions');
const STORE = path.join(DSH_HOME, 'storages', 'workspace.json');
const WORKSPACE = 'D:\\Desktop\\dsh-web-chat-migration';

const brief = fs.readFileSync(process.argv[2], 'utf8');
const title = process.argv[3] || '对话迁移 · 0.4.0 开发交接';

const id = `session-${crypto.randomUUID()}`;
const now = Date.now();

const projectDirName = '--' + WORKSPACE.replace(/[\\/:]+/g, '-') + '--';
const dir = path.join(SESSIONS, projectDirName, id);
fs.mkdirSync(dir, { recursive: true });

const header = {
  type: 'session',
  version: 4,
  id,
  createdAt: now,
  cwd: WORKSPACE,
  isSeeded: false,
  delegationDepth: 0,
  agentPreset: 'standard',
};

const SYSTEM_HEAD =
  '本会话的历史来自一次项目交接：下面的简报概括了 dsh-deepseek-import 的当前状态、架构、已踩过的坑与待办，' +
  '目的是让新的对话快速接上项目，而不必重放全部历史。';

const events = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'step/start', data: { turn: 1, step: 1 } },
  {
    type: 'system/message',
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'system',
        content: [{ type: 'text', text: SYSTEM_HEAD }],
        source: { kind: 'system-prompt' },
        id: crypto.randomUUID(),
      },
    },
  },
  {
    type: 'user/message',
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      content: [{ type: 'text', text: brief }],
      source: { kind: 'user', rpcId: crypto.randomUUID(), clientTimeZone: 'Asia/Shanghai' },
      role: 'user',
      id: crypto.randomUUID(),
    },
  },
  { type: 'step/end', data: { turn: 1, step: 1 } },
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  {
    type: 'session/title',
    data: { title, messageSeqs: [3], source: { kind: 'fallback' } },
  },
].map((event, index) => ({ ...event, seq: index, time: now + index }));

const frames = [
  zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`, 'utf8')),
  ...events.map((e) => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(e)}\n`, 'utf8'))),
];
const file = path.join(dir, 'session.v4.jsonl.zstd');
fs.writeFileSync(file, Buffer.concat(frames));
console.log('written:', file);

const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
const entry = Object.entries(store.tables.workspaces).find(([, ws]) => (ws.path || '').toLowerCase() === WORKSPACE.toLowerCase());
if (!entry) throw new Error('workspace not found');
const [wsId, ws] = entry;
const backup = `${STORE}.bak-handoff-${Date.now()}`;
fs.copyFileSync(STORE, backup);
ws.sessionIds = Array.isArray(ws.sessionIds) ? ws.sessionIds : [];
ws.sessionIds.push(id);
ws.updatedAt = new Date().toISOString();
const required = ['path', 'title', 'sessionIds', 'createdAt', 'updatedAt'];
for (const [, w] of Object.entries(store.tables.workspaces)) {
  const missing = required.filter((k) => !(k in w));
  if (missing.length) {
    fs.copyFileSync(backup, STORE);
    throw new Error(`workspace.json invalid: missing ${missing.join(',')}`);
  }
}
fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n');
console.log('registered in workspace:', ws.title, '| session:', id);
