#!/usr/bin/env node
/**
 * check-sessions.mjs — 启动 DSH 之前先体检，避免「重复 Session ID」导致整个列表加载失败。
 *
 * 用法：
 *   node check-sessions.mjs            # 检查 ~/.dsh
 *   node check-sessions.mjs --verbose  # 逐个会话打印
 *
 * 检查项：
 *   1. Session ID 是否在所有项目目录里唯一（重复会让 DSH 停止加载全部会话）
 *   2. 会话目录名与 header 里的 id 是否一致
 *   3. 每一帧能否解压、每行能否解析、seq 是否连续
 *   4. workspace.json 登记的 id 与磁盘上的目录是否对得上
 *
 * 退出码：0 正常，1 发现问题。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions');
const WORKSPACE_STORE = path.join(DSH_HOME, 'storages', 'workspace.json');
const verbose = process.argv.includes('--verbose');

const problems = [];
const warnings = [];

function decodeFrames(file) {
  const buf = fs.readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const offsets = [];
  for (let i = -1; (i = buf.indexOf(magic, i + 1)) !== -1;) offsets.push(i);
  if (!offsets.length) throw new Error('没有任何 Zstandard 帧');
  return offsets.map((offset, k) =>
    zlib.zstdDecompressSync(buf.slice(offset, offsets[k + 1] ?? buf.length)).toString('utf8')
  );
}

if (!fs.existsSync(SESSIONS_ROOT)) {
  console.error(`找不到 ${SESSIONS_ROOT}`);
  process.exit(1);
}

const byId = new Map();
const details = [];

for (const project of fs.readdirSync(SESSIONS_ROOT)) {
  const projectPath = path.join(SESSIONS_ROOT, project);
  if (!fs.statSync(projectPath).isDirectory()) continue;
  for (const dir of fs.readdirSync(projectPath)) {
    if (!dir.startsWith('session-')) continue;
    const dirPath = path.join(projectPath, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    byId.set(dir, [...(byId.get(dir) || []), project]);

    const file = path.join(dirPath, 'session.v4.jsonl.zstd');
    const record = { id: dir, project, file, ok: true, errors: [], events: 0, cwd: null };
    if (!fs.existsSync(file)) {
      record.ok = false;
      record.errors.push('缺少 session.v4.jsonl.zstd');
      details.push(record);
      continue;
    }
    try {
      const rows = decodeFrames(file)
        .join('')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
      const header = rows[0];
      record.cwd = header.cwd ?? null;
      record.events = rows.length - 1;
      if (header.id !== dir) {
        record.ok = false;
        record.errors.push(`header.id=${header.id} 与目录名 ${dir} 不一致`);
      }
      const badSeq = rows.slice(1).filter((row, index) => row.seq !== index);
      if (badSeq.length) {
        record.ok = false;
        record.errors.push(`${badSeq.length} 行 seq 不连续`);
      }
    } catch (error) {
      record.ok = false;
      record.errors.push(`解压/解析失败：${error.message}`);
    }
    details.push(record);
  }
}

for (const [id, projects] of byId) {
  if (projects.length > 1) problems.push(`重复 Session ID：${id} 出现在 ${projects.join(' , ')}`);
}
for (const record of details) {
  if (!record.ok) problems.push(`${record.id}：${record.errors.join('；')}`);
}
if (verbose) {
  for (const record of details) {
    const flag = record.ok ? '✓' : '✗';
    console.log(`${flag} ${record.id}  ${record.project}  ${record.events} 事件  cwd=${record.cwd}`);
  }
}

// workspace.json ↔ 磁盘 对账
if (fs.existsSync(WORKSPACE_STORE)) {
  try {
    const store = JSON.parse(fs.readFileSync(WORKSPACE_STORE, 'utf8').replace(/^\uFEFF/, ''));
    const registered = new Set();
    for (const ws of Object.values(store.tables?.workspaces ?? {})) {
      for (const id of ws.sessionIds || []) {
        registered.add(id);
        if (!byId.has(id)) warnings.push(`workspace「${ws.title}」登记了 ${id}，但磁盘上没有这个目录`);
      }
    }
    for (const id of byId.keys()) {
      if (!registered.has(id)) warnings.push(`磁盘上有 ${id}，但没有任何工作区登记它`);
    }
  } catch (error) {
    problems.push(`workspace.json 读取失败：${error.message}`);
  }
}

console.log(`检查目录：${SESSIONS_ROOT}`);
console.log(`会话总数：${details.length}，唯一 ID：${byId.size}`);

if (warnings.length) {
  console.log('\n提醒：');
  for (const warning of warnings) console.log(`  · ${warning}`);
}

if (problems.length) {
  console.log('\n发现问题：');
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  console.log('\n在解决之前不要启动 DSH：重复 ID 会让它加载不了任何会话。');
  process.exit(1);
}

console.log('\n✓ 没有重复 ID，所有会话帧可解压、可解析、seq 连续。');
