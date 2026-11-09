#!/usr/bin/env node
/**
 * doctor.mjs — 一条命令体检「导入 → DSH 能打开」这条链路上的所有关键点
 *
 * 检查项：
 *   1. workspace.json 结构（字段齐全、路径存在、登记与磁盘一致）
 *   2. 会话日志结构（帧、seq 连续、system 头位置）
 *   3. 投影缓存（缺缓存的会话在侧栏会显示「未命名」，直到被打开一次）
 *   4. 工作区写权限（Windows：当前用户是否有完全控制）
 *   5. 环境（Node 版本、DSH_HOME、配置文件）
 *
 * 用法：
 *   node doctor.mjs            # 人读
 *   node doctor.mjs --json     # 机器可读
 *   node dsh-import.mjs --doctor
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS = path.join(DSH_HOME, 'sessions');
const STORE = path.join(DSH_HOME, 'storages', 'workspace.json');
const CACHE = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions');

const REQUIRED_WORKSPACE_FIELDS = ['path', 'title', 'sessionIds', 'createdAt', 'updatedAt'];
const SURFACE_TYPES = new Set(['system/message', 'user/message', 'assistant/message', 'developer/message', 'tool/result']);

const results = [];
const record = (section, name, ok, detail = '') => results.push({ section, name, ok, detail });

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

function checkEnvironment() {
  record('环境', 'Node 版本 >= 22', Number(process.versions.node.split('.')[0]) >= 22, process.versions.node);
  record('环境', 'DSH_HOME 存在', fs.existsSync(DSH_HOME), DSH_HOME);
  record('环境', 'workspace.json 存在', fs.existsSync(STORE), STORE);
}

function checkWorkspaces() {
  if (!fs.existsSync(STORE)) return { registered: new Set(), workspaces: [] };
  let store;
  try {
    store = JSON.parse(fs.readFileSync(STORE, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    record('工作区', 'workspace.json 可解析', false, error.message);
    return { registered: new Set(), workspaces: [] };
  }
  record('工作区', 'workspace.json 可解析', true);

  const workspaces = Object.entries(store?.tables?.workspaces ?? {});
  record('工作区', '至少有一个工作区', workspaces.length > 0, `${workspaces.length} 个`);

  const registered = new Set();
  for (const [id, ws] of workspaces) {
    const missing = REQUIRED_WORKSPACE_FIELDS.filter((key) => !(key in ws));
    record('工作区', `字段齐全：${ws.title || id.slice(0, 8)}`, missing.length === 0, missing.join(', ') || 'ok');
    if (ws.path) {
      record('工作区', `路径存在：${ws.title || id.slice(0, 8)}`, fs.existsSync(ws.path), ws.path);
    }
    for (const sessionId of ws.sessionIds || []) registered.add(sessionId);
  }
  return { registered, workspaces };
}

function checkSessions(registered) {
  const onDisk = new Map();
  if (fs.existsSync(SESSIONS)) {
    for (const project of fs.readdirSync(SESSIONS)) {
      const dir = path.join(SESSIONS, project);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.startsWith('session-')) continue;
        onDisk.set(entry, path.join(dir, entry, 'session.v4.jsonl.zstd'));
      }
    }
  }

  let broken = 0;
  let headless = 0;
  let empty = 0;
  let noCache = 0;

  for (const [id, file] of onDisk) {
    if (!fs.existsSync(file)) {
      record('会话', `日志存在：${id.slice(0, 12)}`, false, file);
      broken += 1;
      continue;
    }
    let texts;
    try {
      texts = readFrames(file);
    } catch (error) {
      record('会话', `可解压：${id.slice(0, 12)}`, false, error.message);
      broken += 1;
      continue;
    }
    let rows;
    try {
      rows = texts.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      record('会话', `JSON 可解析：${id.slice(0, 12)}`, false, error.message);
      broken += 1;
      continue;
    }
    const events = rows.slice(1);
    const dense = events.every((event, index) => event.seq === index);
    if (!dense) {
      record('会话', `seq 连续：${id.slice(0, 12)}`, false);
      broken += 1;
    }
    const firstSurface = events.find((event) => SURFACE_TYPES.has(event.type));
    if (!firstSurface) {
      empty += 1;
      continue;
    }
    const systems = events.filter((event) => event.type === 'system/message');
    if (firstSurface.type !== 'system/message' || systems.length === 0) {
      record('会话', `system 头在首位：${id.slice(0, 12)}`, false, `首个 surface 是 ${firstSurface.type}`);
      headless += 1;
    }
    if (!fs.existsSync(path.join(CACHE, `${id}.json`))) noCache += 1;
  }

  record('会话', '日志均可解析', broken === 0, broken ? `${broken} 个有问题` : 'ok');
  record('会话', 'system 头不缺', headless === 0, headless ? `${headless} 个缺（可 --repair）` : 'ok');

  const unregistered = [...onDisk.keys()].filter((id) => !registered.has(id));
  const missingDirs = [...registered].filter((id) => !onDisk.has(id));
  record('会话', '登记与磁盘一致', unregistered.length === 0 && missingDirs.length === 0,
    `未登记 ${unregistered.length} / 目录缺失 ${missingDirs.length}`);

  record('会话', '侧栏标题缓存', noCache === 0,
    noCache ? `${noCache} 个会话没有投影缓存（侧栏先显示「未命名」，打开一次即恢复）` : 'ok');
  record('会话', '会话总数', true, `${onDisk.size} 个（空会话 ${empty} 个）`);

  return { unregistered, missingDirs, headless, noCache };
}

function checkPermissions(workspaces) {
  if (process.platform !== 'win32') {
    record('权限', '平台检查', true, '非 Windows，跳过');
    return;
  }
  // 不直接用 execFileSync 的默认管道：DSH 沙箱里的受限进程打不开命名管道（EPERM）
  const runCapture = (command, args) => {
    const tmp = path.join(os.tmpdir(), `dsh-doctor-${process.pid}-${Math.floor(Math.random() * 1e6)}.txt`);
    let fd;
    let text = '';
    try {
      fd = fs.openSync(tmp, 'w');
      execFileSync(command, args, { stdio: ['ignore', fd, 'ignore'] });
    } catch {
      /* 失败也读回已写出的内容 */
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* 忽略 */
        }
      }
    }
    try {
      text = fs.readFileSync(tmp, 'utf8');
    } catch {
      text = '';
    }
    fs.rmSync(tmp, { force: true });
    return text;
  };

  let user = '';
  try {
    user = runCapture('whoami', []).trim();
  } catch {
    /* 下面统一处理 */
  }
  if (!user) {
    record('权限', '获取当前用户', false, '无法执行 whoami');
    return;
  }
  for (const [, ws] of workspaces) {
    if (!ws.path || !fs.existsSync(ws.path)) continue;
    let listing = '';
    try {
      listing = runCapture('icacls', [ws.path]);
    } catch {
      record('权限', `可读取权限：${ws.title}`, false);
      continue;
    }
    const hasFull = listing
      .split('\n')
      .some((line) => line.toUpperCase().includes(user.toUpperCase()) && /\(F\)/.test(line));
    record('权限', `完全控制：${ws.title}`, hasFull, hasFull ? 'ok' : '缺（DSH 沙箱可能报 grantWrite）');
  }
}

export function runDoctor({ json = false } = {}) {
  checkEnvironment();
  const { registered, workspaces } = checkWorkspaces();
  const sessions = checkSessions(registered);
  checkPermissions(workspaces);

  const failed = results.filter((item) => !item.ok);
  if (json) {
    return { ok: failed.length === 0, results, failed: failed.length };
  }

  let section = '';
  for (const item of results) {
    if (item.section !== section) {
      section = item.section;
      console.log(`\n${section}`);
    }
    console.log(`  ${item.ok ? '✓' : '✗'} ${item.name}${item.detail ? `  ${item.detail}` : ''}`);
  }

  console.log(`\n${failed.length ? `${failed.length} 项需要注意` : '全部通过'}`);
  if (sessions.headless) console.log('  建议：node repair-session.mjs --all');
  if (sessions.unregistered.length) console.log(`  建议：${sessions.unregistered.length} 个会话未登记到任何工作区`);
  if (failed.some((item) => item.section === '权限' && !item.ok)) {
    console.log('  建议：icacls "<工作区>" /grant "<用户>:(OI)(CI)F"');
  }
  return { ok: failed.length === 0, results, failed: failed.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.slice(1))) {
  const json = process.argv.includes('--json');
  const result = runDoctor({ json });
  if (json) console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
