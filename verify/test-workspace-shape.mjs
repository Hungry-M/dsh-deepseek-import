#!/usr/bin/env node
/**
 * test-workspace-shape.mjs — 自动注册工作区时字段必须齐全
 *
 * 回归背景：0.2.5/0.2.6 自动注册时漏写 createdAt，DSH 校验 workspace.json
 * 失败、主窗口起不来。这个测试把「字段齐全 + 时间是合法 ISO」钉死。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REQUIRED = ['path', 'title', 'sessionIds', 'createdAt', 'updatedAt'];

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ws-shape-'));
const home = path.join(root, 'home');
const fresh = path.join(root, 'brand-new-workspace');
fs.mkdirSync(path.join(home, 'storages'), { recursive: true });
fs.writeFileSync(
  path.join(home, 'storages', 'workspace.json'),
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
        ws: {
          path: path.join(root, 'existing'),
          title: 'existing',
          sessionIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    },
  }),
  'utf8'
);

process.env.DSH_HOME = home;

const { runImport } = await import('../dsh-import.mjs');
await runImport({ files: ['samples/fixture-references.json'], workspacePath: fresh });

const store = JSON.parse(fs.readFileSync(path.join(home, 'storages', 'workspace.json'), 'utf8'));
const workspaces = Object.values(store.tables.workspaces);
const entry = workspaces.find((ws) => ws.path.toLowerCase() === fresh.toLowerCase());

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

check('新目录被自动注册', Boolean(entry));
const keys = entry ? Object.keys(entry) : [];
for (const field of REQUIRED) {
  check(`字段 ${field} 存在`, keys.includes(field), keys.join(','));
}
if (entry) {
  check('createdAt 是合法时间', !Number.isNaN(Date.parse(entry.createdAt)), String(entry.createdAt));
  check('updatedAt 是合法时间', !Number.isNaN(Date.parse(entry.updatedAt)), String(entry.updatedAt));
  check('sessionIds 是数组', Array.isArray(entry.sessionIds));
}
check('global.workspaceIds 收录了新工作区', store.global.workspaceIds.length === 2, String(store.global.workspaceIds.length));

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
