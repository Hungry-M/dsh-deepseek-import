#!/usr/bin/env node
/**
 * move-session.mjs — 把已导入（或任意）会话换到另一个 DSH 工作区
 *
 * 用法：
 *   node move-session.mjs --list                      # 列出每个工作区的会话
 *   node move-session.mjs <session-id> --to <工作区路径>
 *   node move-session.mjs <session-id> --to <工作区路径> --dry-run
 *
 * 做的事：
 *   1. 改会话日志头部的 cwd
 *   2. 把会话目录挪到新工作区对应的项目目录下
 *   3. 从旧工作区的 sessionIds 移除、加入新工作区
 *   4. 连同 <旧工作区>/.dsh-imported/<id> 的附件一起搬走
 *   5. 改 workspace.json 前先备份
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions');
const WORKSPACE_STORE = path.join(DSH_HOME, 'storages', 'workspace.json');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const toIndex = argv.findIndex((arg) => arg === '--to');
const targetPath = toIndex >= 0 ? argv[toIndex + 1] : null;
const ids = argv.filter((arg, index) => !arg.startsWith('--') && (toIndex < 0 || index !== toIndex + 1));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function projectDir(workspacePath) {
  return `--${workspacePath.replace(/[\\/:]+/g, '-')}--`;
}

function decodeFrames(file) {
  const buf = fs.readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const offsets = [];
  for (let i = -1; (i = buf.indexOf(magic, i + 1)) !== -1;) offsets.push(i);
  const texts = [];
  for (let k = 0; k < offsets.length; k++) {
    texts.push(zlib.zstdDecompressSync(buf.slice(offsets[k], offsets[k + 1] ?? buf.length)).toString('utf8'));
  }
  return texts;
}

function encodeFrames(texts) {
  return Buffer.concat(texts.map((text) => zlib.zstdCompressSync(Buffer.from(text, 'utf8'))));
}

if (!fs.existsSync(WORKSPACE_STORE)) {
  console.error(`找不到 ${WORKSPACE_STORE}`);
  process.exit(1);
}

const store = readJson(WORKSPACE_STORE);
const workspaces = Object.entries(store.tables?.workspaces ?? {}).map(([id, ws]) => ({
  id,
  path: ws.path,
  title: ws.title || path.basename(ws.path || ''),
  sessionIds: ws.sessionIds || [],
}));

if (argv.includes('--list') || ids.length === 0) {
  for (const ws of workspaces) {
    console.log(`\n[${ws.title}]  ${ws.path}  (${ws.sessionIds.length})`);
    for (const sessionId of ws.sessionIds) console.log(`   ${sessionId}`);
  }
  if (ids.length === 0 && !argv.includes('--list')) {
    console.error('\n用法：node move-session.mjs <session-id> --to <工作区路径>');
    process.exit(1);
  }
  process.exit(0);
}

if (!targetPath) {
  console.error('缺少 --to <工作区路径>。现有工作区：');
  for (const ws of workspaces) console.error(`  ${ws.path}`);
  process.exit(1);
}

const target = workspaces.find((ws) => (ws.path || '').toLowerCase() === path.resolve(targetPath).toLowerCase());
if (!target) {
  console.error(`没有这个工作区：${targetPath}`);
  for (const ws of workspaces) console.error(`  ${ws.path}`);
  process.exit(1);
}

let changed = 0;
for (const sessionId of ids) {
  const current = workspaces.find((ws) => ws.sessionIds.includes(sessionId));
  if (!current) {
    console.error(`跳过 ${sessionId}：没有工作区登记它`);
    continue;
  }
  if (current.id === target.id) {
    console.log(`${sessionId}：已经在「${target.title}」里`);
    continue;
  }

  const fromDir = path.join(SESSIONS_ROOT, projectDir(current.path), sessionId);
  const toDir = path.join(SESSIONS_ROOT, projectDir(target.path), sessionId);
  if (!fs.existsSync(fromDir)) {
    console.error(`跳过 ${sessionId}：找不到会话目录 ${fromDir}`);
    continue;
  }
  if (fs.existsSync(toDir)) {
    console.error(`跳过 ${sessionId}：目标位置已存在 ${toDir}`);
    continue;
  }

  console.log(`\n${sessionId}`);
  console.log(`  从：${current.title}  ${current.path}`);
  console.log(`  到：${target.title}  ${target.path}`);
  console.log(`  目录：${fromDir}`);
  console.log(`     → ${toDir}`);

  const assetsFrom = path.join(current.path, '.dsh-imported', sessionId);
  const assetsTo = path.join(target.path, '.dsh-imported', sessionId);
  if (fs.existsSync(assetsFrom)) console.log(`  附件：${assetsFrom}\n     → ${assetsTo}`);

  if (dryRun) continue;

  // 1) 改头部 cwd，其余帧原样搬
  const file = path.join(fromDir, 'session.v4.jsonl.zstd');
  const frames = decodeFrames(file);
  const header = JSON.parse(frames[0].trim());
  header.cwd = target.path;
  frames[0] = JSON.stringify(header) + '\n';
  fs.writeFileSync(file, encodeFrames(frames));

  // 2) 移动会话目录
  fs.mkdirSync(path.dirname(toDir), { recursive: true });
  fs.renameSync(fromDir, toDir);

  // 3) 搬附件
  if (fs.existsSync(assetsFrom)) {
    fs.mkdirSync(path.dirname(assetsTo), { recursive: true });
    try {
      fs.renameSync(assetsFrom, assetsTo);
    } catch {
      fs.cpSync(assetsFrom, assetsTo, { recursive: true });
      fs.rmSync(assetsFrom, { recursive: true, force: true });
    }
  }

  // 4) 更新登记
  const oldWs = store.tables.workspaces[current.id];
  oldWs.sessionIds = oldWs.sessionIds.filter((id) => id !== sessionId);
  const newWs = store.tables.workspaces[target.id];
  newWs.sessionIds = [...(newWs.sessionIds || []), sessionId];
  newWs.updatedAt = new Date().toISOString();
  changed += 1;
}

if (dryRun) {
  console.log('\n[dry-run] 没有修改任何文件');
  process.exit(0);
}
if (!changed) process.exit(0);

const backup = `${WORKSPACE_STORE}.bak-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
fs.copyFileSync(WORKSPACE_STORE, backup);
fs.writeFileSync(WORKSPACE_STORE, JSON.stringify(store, null, 2) + '\n');
console.log(`\n完成：移动 ${changed} 个会话（workspace.json 备份：${path.basename(backup)}）`);
console.log('重启 DeepSeek Harness 后生效（它只在启动时读 workspace.json）。');
