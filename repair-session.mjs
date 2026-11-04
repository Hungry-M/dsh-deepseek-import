#!/usr/bin/env node
/**
 * repair-session.mjs — 给导入的会话补上 v4 要求的「受保护 system 头」
 *
 * 背景：DSH 会话格式 v4 要求 surface 的第 0 个节点是 system/message。
 * 早期的导入器没写这一条，会话能打开，但一旦继续对话、运行时追加自己的
 * system/message，就会报 `system/message requires a protected first surface head`。
 *
 * 用法：
 *   node repair-session.mjs --audit              # 体检所有会话
 *   node repair-session.mjs <session-dir> --dry-run
 *   node repair-session.mjs <session-dir>
 *   node repair-session.mjs --all [--dry-run]    # 批量修所有需要修的
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS = path.join(DSH_HOME, 'sessions');
const CACHE = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions');

const NOTE =
  '本会话的历史来自 DeepSeek 网页对话的导入，以下消息为用户与助手的原始记录，顺序与原文一致。';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const audit = args.includes('--audit');
const all = args.includes('--all');
const targets = args.filter((a) => !a.startsWith('--'));

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

function writeFrames(file, texts) {
  const encoded = Buffer.concat(texts.map((text) => zlib.zstdCompressSync(Buffer.from(text, 'utf8'))));
  fs.writeFileSync(file, encoded);
}

function sessionFiles() {
  const out = [];
  if (!fs.existsSync(SESSIONS)) return out;
  for (const project of fs.readdirSync(SESSIONS)) {
    const dir = path.join(SESSIONS, project);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.startsWith('session-')) continue;
      const file = path.join(dir, entry, 'session.v4.jsonl.zstd');
      if (fs.existsSync(file)) out.push({ id: entry, file });
    }
  }
  return out;
}

/** 返回 { status, header, events, firstSurfaceIndex, systemIndexes } */
function inspect(file) {
  const texts = readFrames(file);
  const rows = texts.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const header = rows[0];
  const events = rows.slice(1);
  const systemIndexes = events.map((e, i) => (e.type === 'system/message' ? i : -1)).filter((i) => i >= 0);
  const surfaceTypes = new Set(['user/message', 'assistant/message', 'system/message', 'tool/result', 'developer/message']);
  const firstSurfaceIndex = events.findIndex((e) => surfaceTypes.has(e.type));
  return { texts, header, events, systemIndexes, firstSurfaceIndex };
}

function makeSystemEvent(turn, step) {
  return {
    type: 'system/message',
    seq: 0,
    time: Date.now(),
    data: {
      turn,
      step,
      message: {
        role: 'system',
        content: [{ type: 'text', text: NOTE }],
        source: { kind: 'system-prompt' },
        id: crypto.randomUUID(),
      },
    },
    surfaceOp: 'append',
  };
}

function planRepair({ events, systemIndexes, firstSurfaceIndex }) {
  if (firstSurfaceIndex < 0) return { action: 'skip', reason: '没有 surface 事件' };
  if (systemIndexes.length && systemIndexes[0] === firstSurfaceIndex) {
    return { action: 'ok' };
  }

  const copy = events.map((e) => ({ ...e }));
  if (systemIndexes.length) {
    // 已有 system 但在后面：把它挪到 surface 最前面
    const source = copy[systemIndexes[0]];
    copy.splice(systemIndexes[0], 1);
    const target = firstSurfaceIndex;
    copy.splice(target, 0, {
      ...source,
      data: { ...source.data, turn: 1, step: 1 },
      surfaceOp: 'append',
    });
    return { action: 'move', events: copy };
  }

  // 完全没有 system：插到第一个 surface 事件之前
  copy.splice(firstSurfaceIndex, 0, makeSystemEvent(1, 1));
  return { action: 'insert', events: copy };
}

function resequence(events) {
  const mapping = new Map();
  events.forEach((event, index) => mapping.set(event.seq, index));
  const next = events.map((event, index) => ({ ...event, seq: index }));
  // 改写对 seq 的引用（session/title 的 messageSeqs）
  for (const event of next) {
    if (event.type === 'session/title' && Array.isArray(event.data?.messageSeqs)) {
      event.data = {
        ...event.data,
        messageSeqs: event.data.messageSeqs.map((seq) => mapping.get(seq) ?? seq),
      };
    }
  }
  return next;
}

function sessionDirOf(file) {
  return path.dirname(file);
}

function repair(file, plan) {
  const { texts, header } = inspect(file);
  const events = resequence(plan.events);
  const lines = [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))];
  writeFrames(file, lines.map((line) => `${line}\n`));

  const id = path.basename(sessionDirOf(file));
  const cached = path.join(CACHE, `${id}.json`);
  let cacheNote = '';
  if (fs.existsSync(cached)) {
    fs.rmSync(cached, { force: true });
    cacheNote = '，投影缓存已清除';
  }
  return `${plan.action === 'insert' ? '已插入 system 头' : '已把 system 头移到最前'}（${events.length} 条事件${cacheNote}）`;
}

export function auditSessions({ dryRun = false, apply = false } = {}) {
  const list = sessionFiles();
  const problems = [];
  for (const item of list) {
    let info;
    try {
      info = inspect(item.file);
    } catch (error) {
      problems.push({ ...item, status: `读取失败：${error.message}` });
      continue;
    }
    const plan = planRepair(info);
    if (plan.action === 'ok') continue;
    problems.push({ ...item, status: plan.action, plan });
  }

  console.log(`会话总数 ${list.length}，需要处理 ${problems.length}`);
  for (const item of problems) {
    console.log(`  ${item.id}  ${item.status}`);
    if (dryRun || !apply || !item.plan) continue;
    console.log(`    → ${repair(item.file, item.plan)}`);
  }
  if (dryRun) console.log('\n[dry-run] 没有修改任何文件');
  return problems;
}

export function repairSessions(paths, { dryRun = false } = {}) {
  for (const target of paths) {
    const dir = target.endsWith('session.v4.jsonl.zstd') ? path.dirname(target) : target;
    const file = path.join(dir, 'session.v4.jsonl.zstd');
    if (!fs.existsSync(file)) {
      console.error(`找不到 ${file}`);
      continue;
    }
    const info = inspect(file);
    const plan = planRepair(info);
    console.log(`${path.basename(dir)}: ${plan.action}`);
    if (plan.action === 'ok' || plan.action === 'skip' || dryRun) continue;
    console.log('  → ' + repair(file, plan));
  }
}

// ---------------------------------------------------------------- 入口

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  if (audit || all) {
    auditSessions({ dryRun, apply: all });
    process.exit(0);
  }

  if (!targets.length) {
    console.error('用法：node repair-session.mjs --audit | <session-dir> [--dry-run] | --all');
    process.exit(1);
  }

  repairSessions(targets, { dryRun });
}

