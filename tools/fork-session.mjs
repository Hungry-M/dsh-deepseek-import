#!/usr/bin/env node
/**
 * fork-session.mjs — 从某个会话的「某一轮之前」复制出一份新会话（原会话完全不动）。
 *
 * 用法：
 *   node fork-session.mjs --from <session-id> --match "一段用户消息里的文字" [--dry-run]
 *   node fork-session.mjs --from <session-id> --turn 20 [--dry-run]
 *
 * 选项：
 *   --cwd <path>   新会话的工作区（默认沿用源会话的 cwd）
 *   --title <text> 覆盖标题
 *   --dry-run      只打印计划
 *
 * 做的事：
 *   1. 读源会话（只读，不会写回）
 *   2. 找到包含 --match 的用户消息，定位它所属轮次的起点
 *   3. 截取「该轮之前」的全部事件，分配新 ID，改 cwd
 *   4. 写到同一个项目目录，登记进对应工作区
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions');
const WORKSPACE_STORE = path.join(DSH_HOME, 'storages', 'workspace.json');

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const dryRun = argv.includes('--dry-run');
const fromId = arg('--from');
const match = arg('--match');
const turnNo = arg('--turn') ? Number(arg('--turn')) : null;
const cwdOverride = arg('--cwd');
const titleOverride = arg('--title');

if (!fromId || (!match && !turnNo)) {
  console.error('用法：node fork-session.mjs --from <session-id> --match "文字" [--dry-run]');
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function projectDir(workspacePath) {
  return `--${workspacePath.replace(/[\\/:]+/g, '-')}--`;
}

function findSession(id) {
  for (const project of fs.readdirSync(SESSIONS_ROOT)) {
    const dir = path.join(SESSIONS_ROOT, project, id);
    if (fs.existsSync(dir)) return { dir, project };
  }
  return null;
}

/** 解压所有帧；末尾撕裂帧直接丢弃（会话正在写时会有） */
function decodeRows(file) {
  const buf = fs.readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const offsets = [];
  for (let i = -1; (i = buf.indexOf(magic, i + 1)) !== -1;) offsets.push(i);
  const texts = [];
  let torn = 0;
  for (let k = 0; k < offsets.length; k++) {
    try {
      texts.push(zlib.zstdDecompressSync(buf.slice(offsets[k], offsets[k + 1] ?? buf.length)).toString('utf8'));
    } catch {
      torn += 1;
    }
  }
  const rows = texts
    .join('')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  return { rows, torn };
}

function textOf(event) {
  if (event?.type !== 'user/message') return '';
  const blocks = event.data?.content || [];
  return blocks.map((block) => block?.text ?? '').join('\n');
}

const found = findSession(fromId);
if (!found) {
  console.error(`找不到会话 ${fromId}`);
  process.exit(1);
}

const file = path.join(found.dir, 'session.v4.jsonl.zstd');
const { rows, torn } = decodeRows(file);
const header = rows[0];
const events = rows.slice(1);
const sourceCwd = cwdOverride || header.cwd;

console.log(`源会话   : ${fromId}`);
console.log(`cwd      : ${sourceCwd}`);
console.log(`事件数   : ${events.length}${torn ? `（丢弃撕裂帧 ${torn} 个）` : ''}`);

// 定位截断点：包含 match 的那条用户消息所属轮次的 turn/start，
// 再往前退到上一个 turn/end 之后，保证新会话以完整轮次收尾。
let cutEventIndex = -1;
let hitText = null;
if (match) {
  const textIndex = events.findIndex((event) => textOf(event).includes(match));
  if (textIndex < 0) {
    console.error(`没有找到包含该文字的用户消息：${match}`);
    process.exit(1);
  }
  hitText = textOf(events[textIndex]).slice(0, 80);
  let turnStart = textIndex;
  while (turnStart >= 0 && events[turnStart].type !== 'turn/start') turnStart -= 1;
  cutEventIndex = turnStart >= 0 ? turnStart : textIndex;
} else {
  const turnStart = events.findIndex((event) => event.type === 'turn/start' && event.data?.turn === turnNo);
  if (turnStart < 0) {
    console.error(`没有找到第 ${turnNo} 轮`);
    process.exit(1);
  }
  cutEventIndex = turnStart;
}

// 回退到上一个 turn/end 之后，避免留下孤立的 agent/inbox/spliced 或未收尾的轮次
for (let i = cutEventIndex - 1; i >= 0; i -= 1) {
  if (events[i].type === 'turn/end') {
    cutEventIndex = i + 1;
    break;
  }
  if (events[i].type === 'turn/start') break;
}

const kept = events.slice(0, cutEventIndex);
const dropped = events.slice(cutEventIndex);
const lastKept = kept[kept.length - 1];
console.log(`截断位置 : 第 ${cutEventIndex} 个事件之前（保留 ${kept.length}，丢弃 ${dropped.length}）`);
if (hitText) console.log(`命中消息 : 「${hitText}…」`);
console.log(`保留到   : ${lastKept?.type ?? '（无）'} (seq ${lastKept?.seq ?? '-'})`);

if (lastKept && lastKept.type !== 'turn/end') {
  console.warn('⚠ 截断后最后一条不是 turn/end，会话可能以未结束的轮次收尾');
}

const newId = `session-${crypto.randomUUID()}`;
console.log(`新会话   : ${newId}`);

if (dryRun) {
  console.log('\n[dry-run] 没有写任何东西');
  process.exit(0);
}

// 换 ID：header 与保留事件里所有等于旧 ID 的字符串
function remap(value) {
  if (typeof value === 'string') return value === fromId ? newId : value;
  if (Array.isArray(value)) return value.map(remap);
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) value[key] = remap(value[key]);
  }
  return value;
}

const newHeader = remap({ ...header, id: newId, cwd: sourceCwd });
if (titleOverride) {
  // 标题事件在保留区间里的话一起改
  for (const event of kept) {
    if (event.type === 'session/title') event.data.title = titleOverride;
  }
}
const newEvents = kept.map((event) => remap(event));

const targetDir = path.join(SESSIONS_ROOT, projectDir(sourceCwd), newId);
fs.mkdirSync(targetDir, { recursive: true });
const payload = Buffer.concat([
  zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(newHeader)}\n`, 'utf8')),
  ...newEvents.map((event) => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`, 'utf8'))),
]);
fs.writeFileSync(path.join(targetDir, 'session.v4.jsonl.zstd'), payload);
console.log(`\n✓ 已写入 ${targetDir}`);

// 登记
const store = readJson(WORKSPACE_STORE);
const entry = Object.entries(store.tables.workspaces).find(
  ([, ws]) => (ws.path || '').toLowerCase() === path.resolve(sourceCwd).toLowerCase()
);
if (!entry) {
  console.warn('⚠ 找不到对应的工作区条目，新会话没有登记；重启后在 DSH 里打开该目录可重新登记');
} else {
  const backup = `${WORKSPACE_STORE}.bak-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  fs.copyFileSync(WORKSPACE_STORE, backup);
  const [, ws] = entry;
  ws.sessionIds = Array.isArray(ws.sessionIds) ? ws.sessionIds : [];
  ws.sessionIds.push(newId);
  ws.updatedAt = new Date().toISOString();
  fs.writeFileSync(WORKSPACE_STORE, `${JSON.stringify(store, null, 2)}\n`);
  console.log(`✓ 已登记到工作区「${ws.title}」（备份：${path.basename(backup)}）`);
}

console.log('\n重启 DSH 后可在会话列表看到这条分支。');
