#!/usr/bin/env node
/**
 * remove-session.mjs — 彻底删除导入过的会话（会话日志 + 列表登记 + 落盘附件 + 投影缓存）
 *
 * 用法：
 *   node remove-session.mjs <session-id> [--dry-run]
 *   node remove-session.mjs --list-imported      # 列出 .dsh-imported 下的会话
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions');
const WORKSPACE_STORE = path.join(DSH_HOME, 'storages', 'workspace.json');
const PROJ_CACHE = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const ids = args.filter((arg) => !arg.startsWith('--'));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function findSessionDirs(sessionId) {
  const hits = [];
  if (!fs.existsSync(SESSIONS_ROOT)) return hits;
  for (const project of fs.readdirSync(SESSIONS_ROOT)) {
    const candidate = path.join(SESSIONS_ROOT, project, sessionId);
    if (fs.existsSync(candidate)) hits.push(candidate);
  }
  return hits;
}

function findAssetDirs(sessionId) {
  const table = readJson(WORKSPACE_STORE)?.tables?.workspaces ?? {};
  const hits = [];
  for (const ws of Object.values(table)) {
    if (!ws.path) continue;
    const candidate = path.join(ws.path, '.dsh-imported', sessionId);
    if (fs.existsSync(candidate)) hits.push(candidate);
  }
  return hits;
}

if (args[0] === '--list-imported') {
  const table = readJson(WORKSPACE_STORE)?.tables?.workspaces ?? {};
  for (const ws of Object.values(table)) {
    if (!ws.path) continue;
    const root = path.join(ws.path, '.dsh-imported');
    if (!fs.existsSync(root)) continue;
    for (const id of fs.readdirSync(root)) console.log(`${id}\t${root}`);
  }
  process.exit(0);
}

if (!ids.length) {
  console.error('用法：node remove-session.mjs <session-id> [--dry-run]');
  process.exit(1);
}

const store = readJson(WORKSPACE_STORE);
let removedFromStore = 0;
for (const ws of Object.values(store.tables?.workspaces ?? {})) {
  if (!Array.isArray(ws.sessionIds)) continue;
  const before = ws.sessionIds.length;
  ws.sessionIds = ws.sessionIds.filter((id) => !ids.includes(id));
  removedFromStore += before - ws.sessionIds.length;
}

for (const id of ids) {
  const dirs = findSessionDirs(id);
  const assets = findAssetDirs(id);
  const cache = path.join(PROJ_CACHE, `${id}.json`);

  console.log(`\n${id}`);
  console.log(`  会话目录 : ${dirs.length ? dirs.join(', ') : '（无）'}`);
  console.log(`  附件目录 : ${assets.length ? assets.join(', ') : '（无）'}`);
  console.log(`  投影缓存 : ${fs.existsSync(cache) ? cache : '（无）'}`);

  if (dryRun) continue;
  for (const dir of [...dirs, ...assets]) fs.rmSync(dir, { recursive: true, force: true });
  if (fs.existsSync(cache)) fs.rmSync(cache, { force: true });
}

if (!dryRun) {
  const backup = `${WORKSPACE_STORE}.bak-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  fs.copyFileSync(WORKSPACE_STORE, backup);
  fs.writeFileSync(WORKSPACE_STORE, JSON.stringify(store, null, 2) + '\n');
  console.log(`\n已从 workspace.json 移除 ${removedFromStore} 条登记（备份：${path.basename(backup)}）`);
  console.log('请完全退出并重启 DeepSeek Harness，列表才会刷新。');
}
