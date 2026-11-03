#!/usr/bin/env node
/**
 * copy-workspace.mjs — 把当前工作区（含会话）**复制**到新位置，原位置一个字节都不动。
 *
 * 用法：
 *   node copy-workspace.mjs <目标目录> [选项]
 *
 * 选项：
 *   --extracted        连 extracted/ 一起复制（asar 抽出来的包，约 15 MB，可重新生成）
 *   --sessions none    不复制会话，只复制文件
 *   --only <id,id>     只复制指定会话
 *   --dry-run          只打印计划，不写盘
 *
 * 做的事：
 *   1. 复制工作区文件到 <目标目录>
 *   2. 复制会话日志到 ~/.dsh/sessions/--<目标目录>--/，并把头部 cwd 改成新路径
 *   3. 在 workspace.json 里给目标目录建条目（或复用），登记这些会话
 *   4. 改 workspace.json 前先备份
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SOURCE = path.dirname(fileURLToPath(import.meta.url));
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions');
const WORKSPACE_STORE = path.join(DSH_HOME, 'storages', 'workspace.json');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const withExtracted = argv.includes('--extracted');
const sessionsIndex = argv.indexOf('--sessions');
const sessionsMode = sessionsIndex >= 0 ? argv[sessionsIndex + 1] : 'all';
const onlyIndex = argv.indexOf('--only');
const onlyIds = onlyIndex >= 0 ? String(argv[onlyIndex + 1] || '').split(',').filter(Boolean) : null;
const targetArg = argv.find((arg, i) => !arg.startsWith('--') && (sessionsIndex < 0 || i !== sessionsIndex + 1) && (onlyIndex < 0 || i !== onlyIndex + 1));

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

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
  return offsets.map((offset, k) => zlib.zstdDecompressSync(buf.slice(offset, offsets[k + 1] ?? buf.length)).toString('utf8'));
}

function encodeFrames(texts) {
  return Buffer.concat(texts.map((text) => zlib.zstdCompressSync(Buffer.from(text, 'utf8'))));
}

/** 扫描所有项目目录，找出重复的 Session ID（重复会让 DSH 整个列表加载失败） */
function scanSessionIds() {
  const map = new Map();
  if (!fs.existsSync(SESSIONS_ROOT)) return map;
  for (const project of fs.readdirSync(SESSIONS_ROOT)) {
    const projectPath = path.join(SESSIONS_ROOT, project);
    let stat;
    try {
      stat = fs.statSync(projectPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    for (const dir of fs.readdirSync(projectPath)) {
      if (!dir.startsWith('session-')) continue;
      map.set(dir, [...(map.get(dir) || []), project]);
    }
  }
  return map;
}

// ---------------------------------------------------------------- 校验

if (!targetArg) {
  console.error('用法：node copy-workspace.mjs <目标目录> [--extracted] [--sessions none] [--only id,id] [--dry-run]');
  process.exit(1);
}

const target = path.resolve(targetArg.replace(/^["']|["']$/g, ''));
const source = path.resolve(SOURCE);

if (samePath(target, source)) {
  console.error('目标目录和工作区是同一个地方');
  process.exit(1);
}
if (target.toLowerCase().startsWith(source.toLowerCase() + path.sep)) {
  console.error('目标目录不能在工作区里面');
  process.exit(1);
}
if (source.toLowerCase().startsWith(target.toLowerCase() + path.sep)) {
  console.error('目标目录不能是工作区的上级');
  process.exit(1);
}
if (!fs.existsSync(source)) {
  console.error(`找不到工作区：${source}`);
  process.exit(1);
}

const store = readJson(WORKSPACE_STORE);
const workspaces = Object.entries(store.tables?.workspaces ?? {}).map(([id, ws]) => ({ id, ...ws }));
const sourceWs = workspaces.find((ws) => samePath(ws.path || '', source));

let sessionIds = (sourceWs?.sessionIds || []).filter((id) => fs.existsSync(path.join(SESSIONS_ROOT, projectDir(source), id)));
if (onlyIds) sessionIds = sessionIds.filter((id) => onlyIds.includes(id));
if (sessionsMode === 'none') sessionIds = [];

console.log(`源工作区 : ${source}`);
console.log(`目标目录 : ${target}`);
console.log(`会话     : ${sessionIds.length ? `${sessionIds.length} 个（复制时会换新 ID）` : '不复制'}`);
for (const id of sessionIds) console.log(`  - ${id}`);
console.log(`extracted: ${withExtracted ? '复制' : '跳过（约 15 MB，可重新生成）'}`);

const existing = scanSessionIds();
const duplicates = [...existing.entries()].filter(([, dirs]) => dirs.length > 1);
if (duplicates.length) {
  console.log('\n⚠ 当前已经存在重复 Session ID（DSH 会加载失败）：');
  for (const [id, dirs] of duplicates) console.log(`  ${id} → ${dirs.join(' , ')}`);
}

if (target && fs.existsSync(target) && fs.readdirSync(target).length > 0) {
  console.log('\n⚠ 目标目录已存在且非空，同名文件会被覆盖。');
}

if (dryRun) {
  console.log('\n[dry-run] 没有写任何东西');
  process.exit(0);
}

// ---------------------------------------------------------------- 复制文件

fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, {
  recursive: true,
  force: true,
  filter: (src) => {
    const rel = path.relative(source, src);
    if (!rel) return true;
    const parts = rel.split(path.sep);
    if (parts[0] === 'extracted' && !withExtracted) return false;
    if (parts[0] === '.git') return false;
    if (parts[0].startsWith('.test-')) return false;
    if (rel === 'import.log') return false;
    return true;
  },
});
console.log(`\n✓ 文件已复制到 ${target}`);

// ---------------------------------------------------------------- 复制会话

// 关键：DSH 要求 Session ID 全局唯一。同一 ID 出现在两个项目目录时，
// 整个会话列表会加载失败（duplicate JSONL session id）。所以复制时必须换 ID，
// 并且把所有引用到旧 ID 的地方一起改掉（header.id、投递标记等）。
function remapIds(value, oldId, newId) {
  if (typeof value === 'string') return value === oldId ? newId : value;
  if (Array.isArray(value)) return value.map((item) => remapIds(item, oldId, newId));
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) value[key] = remapIds(value[key], oldId, newId);
  }
  return value;
}

const copiedSessions = [];
for (const oldId of sessionIds) {
  const from = path.join(SESSIONS_ROOT, projectDir(source), oldId);
  const newId = `session-${crypto.randomUUID()}`;
  const to = path.join(SESSIONS_ROOT, projectDir(target), newId);
  if (fs.existsSync(to)) {
    console.error(`跳过 ${oldId}：目标已存在 ${newId}`);
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true });

  const file = path.join(to, 'session.v4.jsonl.zstd');
  if (!fs.existsSync(file)) {
    console.error(`跳过 ${oldId}：找不到会话日志`);
    fs.rmSync(to, { recursive: true, force: true });
    continue;
  }

  // 一个 Zstandard 帧里可能压着多行（DSH 按批次写），必须先拼起来再按行解析
  const rows = decodeFrames(file)
    .join('')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const header = remapIds(rows[0], oldId, newId);
  header.cwd = target;
  const events = rows.slice(1).map((row) => remapIds(row, oldId, newId));

  fs.writeFileSync(
    file,
    encodeFrames([`${JSON.stringify(header)}\n`, ...events.map((row) => `${JSON.stringify(row)}\n`)])
  );
  copiedSessions.push(newId);
  console.log(`✓ 会话 ${oldId}\n    → ${newId}`);
}

// ---------------------------------------------------------------- 登记工作区

if (copiedSessions.length) {
  const backup = `${WORKSPACE_STORE}.bak-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  fs.copyFileSync(WORKSPACE_STORE, backup);

  const fresh = readJson(WORKSPACE_STORE);
  let entry = Object.entries(fresh.tables.workspaces).find(([, ws]) => samePath(ws.path || '', target));
  if (!entry) {
    const id = crypto.randomUUID();
    fresh.tables.workspaces[id] = {
      path: target,
      title: path.basename(target),
      sessionIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fresh.global.workspaceIds = [...(fresh.global.workspaceIds || []), id];
    entry = [id, fresh.tables.workspaces[id]];
    console.log(`\n✓ 新建工作区条目 ${path.basename(target)}`);
  }
  const [, ws] = entry;
  ws.sessionIds = Array.isArray(ws.sessionIds) ? ws.sessionIds : [];
  for (const id of copiedSessions) if (!ws.sessionIds.includes(id)) ws.sessionIds.push(id);
  ws.updatedAt = new Date().toISOString();

  fs.writeFileSync(WORKSPACE_STORE, `${JSON.stringify(fresh, null, 2)}\n`);
  console.log(`✓ 已在 workspace.json 登记（备份：${path.basename(backup)}）`);
}

// ---------------------------------------------------------------- 收尾检查

const after = scanSessionIds();
const stillDuplicate = [...after.entries()].filter(([, dirs]) => dirs.length > 1);
if (stillDuplicate.length) {
  console.log('\n[警告] 仍然存在重复 Session ID，DSH 可能加载失败：');
  for (const [id, dirs] of stillDuplicate) console.log(`  ${id} → ${dirs.join(' , ')}`);
} else {
  console.log(`\n✓ Session ID 全局唯一（共 ${after.size} 个会话）`);
}

console.log(`
完成。接下来：
  1. 打开 DeepSeek Harness
  2. 在左侧工作区里选择「${path.basename(target)}」
  3. 会话列表里应该能看到复制过来的对话

原工作区未做任何修改：${source}`);
