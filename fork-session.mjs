#!/usr/bin/env node
/**
 * fork-session.mjs — 把一个会话截断到指定轮次，生成一个新的独立会话
 *
 * 用途：给长期对话做「分支存档」，让后续开发从一个干净、短小的上下文继续。
 *
 * 用法：
 *   node fork-session.mjs --session current --cut-turn 101 --title "对话迁移 0.3.1 分支"
 *   node fork-session.mjs --session <id> --cut-seq 9067 --dry-run
 *
 * 安全约束（都是踩过的坑）：
 *   - 只在 turn/end 处切，避免留下半轮
 *   - 新 UUID，绝不复制原 id（重复 id 会让整个会话列表加载失败）
 *   - 不复制投影缓存，让 DSH 重建
 *   - workspace.json 写入前做字段自检，缺字段直接回滚
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS = path.join(DSH_HOME, 'sessions');
const STORE = path.join(DSH_HOME, 'storages', 'workspace.json');
const CACHE = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
function value(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

const wantSession = value('--session') || 'current';
const cutTurn = value('--cut-turn') ? Number(value('--cut-turn')) : null;
const cutSeq = value('--cut-seq') ? Number(value('--cut-seq')) : null;
const newTitle = value('--title');

if (cutTurn === null && cutSeq === null) {
  console.error('需要 --cut-turn N 或 --cut-seq N');
  process.exit(1);
}

function readFrames(file) {
  const buf = fs.readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const offsets = [];
  for (let i = -1; (i = buf.indexOf(magic, i + 1)) !== -1;) offsets.push(i);
  const texts = [];
  for (let k = 0; k < offsets.length; k++) {
    texts.push(zlib.zstdDecompressSync(buf.subarray(offsets[k], offsets[k + 1] ?? buf.length)).toString('utf8'));
  }
  return texts;
}

function locate(file) {
  const rows = readFrames(file).join('').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { header: rows[0], events: rows.slice(1) };
}

/** 找到所有会话文件，按修改时间倒序 */
function allSessions() {
  const out = [];
  for (const project of fs.readdirSync(SESSIONS)) {
    const dir = path.join(SESSIONS, project);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.startsWith('session-')) continue;
      const file = path.join(dir, entry, 'session.v4.jsonl.zstd');
      if (!fs.existsSync(file)) continue;
      out.push({ id: entry, project, dir: path.join(dir, entry), file, mtime: fs.statSync(file).mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

const sessions = allSessions();
const source =
  wantSession === 'current' ? sessions[0] : sessions.find((s) => s.id === wantSession || s.id.includes(wantSession));
if (!source) {
  console.error(`找不到会话：${wantSession}`);
  process.exit(1);
}

const { header, events } = locate(source.file);
console.log(`源会话：${source.id}`);
console.log(`  事件 ${events.length} 条，轮数 ${events.filter((e) => e.type === 'turn/start').length}`);

// 计算截断点：必须落在 turn/end
let endSeq;
if (cutSeq !== null) {
  endSeq = cutSeq;
  const ev = events.find((e) => e.seq === endSeq);
  if (!ev || ev.type !== 'turn/end') {
    console.error(`seq ${endSeq} 不是 turn/end（实际 ${ev?.type}），拒绝在半轮处切分`);
    process.exit(1);
  }
} else {
  const end = events.find((e) => e.type === 'turn/end' && e.data.turn === cutTurn);
  if (!end) {
    console.error(`找不到第 ${cutTurn} 轮的 turn/end`);
    process.exit(1);
  }
  endSeq = end.seq;
}

const kept = events.slice(0, endSeq + 1);

// 不变量自检
const surface = new Set(['system/message', 'user/message', 'assistant/message', 'developer/message', 'tool/result']);
const firstSurface = kept.find((e) => surface.has(e.type));
const systemCount = kept.filter((e) => e.type === 'system/message').length;
const dense = kept.every((e, i) => e.seq === i);
console.log(`截断点：seq ${endSeq}（第 ${kept.filter((e) => e.type === 'turn/start').length} 轮结束）`);
console.log(`  保留 ${kept.length} 条；system 头：${systemCount} 条，首个 surface=${firstSurface?.type}；seq 连续=${dense}`);
// 受保护 system 头只需存在且在 surface 首位；后续 system/message 允许出现（系统提示更新）
if (!dense || systemCount < 1 || firstSurface?.type !== 'system/message') {
  console.error('不变量不满足，拒绝生成');
  process.exit(1);
}

const newId = `session-${crypto.randomUUID()}`;
const newHeader = {
  ...header,
  id: newId,
  createdAt: Date.now(),
  ...(header.version === 4 ? {} : { version: 4 }),
};

// 复制事件；改写标题，方便在侧栏区分
const copied = kept.map((event) => {
  if (event.type === 'session/title' && newTitle) {
    return { ...event, data: { ...event.data, title: newTitle } };
  }
  return event;
});

console.log(`新会话：${newId}${newTitle ? `（标题：${newTitle}）` : ''}`);
if (dryRun) {
  console.log('[dry-run] 未写入任何文件');
  process.exit(0);
}

// 写入：第一帧只有 header，之后每条记录一帧
const targetDir = path.join(source.project === undefined ? '' : path.dirname(source.dir), newId);
const dir = path.join(path.dirname(source.dir), newId);
fs.mkdirSync(dir, { recursive: true });
const frames = [
  zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(newHeader)}\n`, 'utf8')),
  ...copied.map((event) => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`, 'utf8'))),
];
const outFile = path.join(dir, 'session.v4.jsonl.zstd');
fs.writeFileSync(outFile, Buffer.concat(frames));
console.log(`已写入：${outFile}（${frames.length} 帧）`);

// 登记到原会话所属的工作区
const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
const entry = Object.entries(store.tables.workspaces).find(([, ws]) => (ws.sessionIds || []).includes(source.id));
if (!entry) {
  console.warn('原会话没有登记在任何工作区，新会话也未登记；请在 DSH 里手动添加');
  process.exit(0);
}
const [wsId, ws] = entry;
const backup = `${STORE}.bak-fork-${Date.now()}`;
fs.copyFileSync(STORE, backup);
ws.sessionIds = Array.isArray(ws.sessionIds) ? ws.sessionIds : [];
if (!ws.sessionIds.includes(newId)) ws.sessionIds.push(newId);
ws.updatedAt = new Date().toISOString();

const required = ['path', 'title', 'sessionIds', 'createdAt', 'updatedAt'];
for (const [id, w] of Object.entries(store.tables.workspaces)) {
  const missing = required.filter((key) => !(key in w));
  if (missing.length) {
    fs.copyFileSync(backup, STORE);
    console.error(`workspace.json 自检失败：${id} 缺 ${missing.join(',')}，已回滚`);
    process.exit(1);
  }
}
fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n');
console.log(`已登记到工作区「${ws.title}」（备份 ${path.basename(backup)}）`);

// 投影缓存不存在，DSH 会冷读重建
const cacheFile = path.join(CACHE, `${newId}.json`);
if (fs.existsSync(cacheFile)) fs.rmSync(cacheFile, { force: true });
console.log('\n完成。重启 DeepSeek Harness 后，侧栏该工作区会出现新会话。');
