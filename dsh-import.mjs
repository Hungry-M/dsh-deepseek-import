#!/usr/bin/env node
/**
 * dsh-import.mjs — 把 Edge 扩展导出的 DeepSeek 对话重建为 DSH 会话
 *
 * 用法：
 *   node dsh-import.mjs <导出文件或目录> [更多文件...] [选项]
 *
 * 选项：
 *   --workspace <路径>   导入到哪个 DSH 工作区（默认交互选择）
 *   --list               只列出工作区，不导入
 *   --thinking           保留思考过程（默认丢弃）
 *   --dry-run            只解析并打印，不写盘
 *   --no-register        只写会话文件，不修改 workspace.json
 *
 * 原理：
 *   DSH 的会话是 ~/.dsh/sessions/--<规范化工作区路径>--/session-<uuid>/session.v4.jsonl.zstd，
 *   而侧边栏列表来自 ~/.dsh/storages/workspace.json 里的 sessionIds 数组。
 *   本脚本两处都写，并在改 workspace.json 前留备份。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- 日志

// 同时写控制台和 import.log：脚本自己记录，cmd 就不用重定向 stdout，
// 交互式提问（选择工作区）才能正常显示。
// 脚本所在目录：源码运行时用 import.meta.url；打包成单文件（SEA / CJS）时退回 exe 目录
const SCRIPT_DIR = (() => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return path.dirname(process.execPath);
  }
})();

const LOG_FILE = path.join(SCRIPT_DIR, 'import.log');
try {
  fs.writeFileSync(LOG_FILE, `===== ${new Date().toLocaleString('zh-CN')} =====\n`);
} catch {
  /* 没有写权限就不记日志 */
}

function tee(...args) {
  const line = args
    .map((value) => (typeof value === 'string' ? value : String(value)))
    .join(' ');
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    /* 忽略日志失败 */
  }
  return line;
}

const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);
let quiet = false; // --json 模式下只写日志文件，不往终端刷
console.log = (...args) => {
  const line = tee(...args);
  if (!quiet) originalLog(line);
};
console.error = (...args) => {
  const line = tee(...args);
  if (!quiet) originalError(line);
};

// ---------------------------------------------------------------- 参数

const opts = { files: [], workspace: null, list: false, thinking: false, dryRun: false, register: true, json: false, dir: null, setDir: null, lang: null, keepAll: false, keepInterrupted: false, noSidecar: false, sidecarDir: null };

function parseArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--workspace' || arg === '-w') opts.workspace = argv[++i];
    else if (arg === '--list') opts.list = true;
    else if (arg === '--thinking') opts.thinking = true;
    else if (arg === '--keep-all' || arg === '--keep-versions') opts.keepAll = true;
    else if (arg === '--keep-interrupted') opts.keepInterrupted = true;
    else if (arg === '--tail') opts.tail = Number(argv[++i]);
    else if (arg === '--no-auto-trim') opts.autoTrim = false;
    else if (arg === '--no-system-head') opts.noSystemHead = true;
    else if (arg === '--no-acl-fix') opts.noAclFix = true;
    else if (arg === '--doctor') opts.doctor = true;
    else if (arg === '--audit') opts.audit = true;
    else if (arg === '--repair') { opts.audit = true; opts.applyRepair = true; }
    else if (arg === '--no-sidecar' || arg === '--sidecar') opts.noSidecar = true;
    else if (arg === '--sidecar-dir') opts.sidecarDir = argv[++i];
    else if (arg === '--context-window') opts.contextWindow = Number(argv[++i]) || null;
    else if (arg === '--provider') opts.provider = argv[++i];
    else if (arg === '--model') opts.model = argv[++i];
    else if (arg === '--from-index') opts.fromIndex = Number(argv[++i]);
    else if (arg === '--from-match') opts.fromMatch = argv[++i];
    else if (arg === '--only') opts.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-register') opts.register = false;
    else if (arg === '--dir') opts.dir = argv[++i];
    else if (arg === '--set-dir') opts.setDir = argv[++i];
    else if (arg === '--lang') opts.lang = argv[++i];
    else if (arg === '--json') {
      opts.json = true;
      quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else opts.files.push(arg);
  }
}

// ---------------------------------------------------------------- 找导出文件

function expandEnv(value) {
  return String(value).replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole);
}

/** 系统层面的「下载」目录（不含用户配置） */
function systemDownloadDirs() {
  const dirs = [];
  if (process.platform === 'win32') {
    try {
      const out = execFileSync(
        'reg',
        [
          'query',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
          '/v',
          '{374DE290-123F-4565-9164-39C4925E467B}',
        ],
        { encoding: 'utf8' }
      );
      const match = out.match(/REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m);
      if (match) dirs.push(expandEnv(match[1].trim()));
    } catch {
      /* 拿不到注册表就退回候选目录 */
    }
  }
  dirs.push(path.join(os.homedir(), 'Downloads'));
  for (const letter of ['C', 'D', 'E', 'F', 'G', 'H']) {
    dirs.push(`${letter}:\\Downloads`);
  }
  return [...new Set(dirs.filter((dir) => dir && fs.existsSync(dir)))];
}

// ---------------------------------------------------------------- 配置

const CONFIG_FILE = path.join(SCRIPT_DIR, 'import.config.json');

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

let config = readConfigFile();

function getConfig() {
  return {
    downloadDir: config.downloadDir || systemDownloadDirs()[0] || '',
    subdir: config.subdir || 'dsh-import',
    lang: config.lang === 'en' ? 'en' : 'zh',
    // 超长对话默认自动截断：超过 autoTrimChars 就只导入最后 autoTrimTurns 轮
    autoTrim: config.autoTrim !== false,
    autoTrimChars: Number(config.autoTrimChars) || 120000,
    autoTrimTurns: Number(config.autoTrimTurns) || 20,
    autoTrimBudget: Number(config.autoTrimBudget) || 60000,
    ...config,
  };
}

function saveConfig(patch) {
  config = { ...getConfig(), ...patch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  return getConfig();
}

/** 实际要扫描的目录：配置优先，其次系统下载目录；每个目录还会看子目录 */
function downloadDirs() {
  const current = getConfig();
  const dirs = [];
  if (current.downloadDir) dirs.push(current.downloadDir);
  dirs.push(...systemDownloadDirs());
  const expanded = [];
  for (const dir of dirs) {
    expanded.push(dir);
    if (current.subdir) expanded.push(path.join(dir, current.subdir));
  }
  return [...new Set(expanded.filter((dir) => dir && fs.existsSync(dir)))];
}

/**
 * 认不认这个文件：约定名直接认；改过名的 .json 就看开头有没有格式标记。
 * （用户把导出文件重命名成「项目A.json」这种情况。）
 */
function looksLikeExport(file) {
  const name = path.basename(file);
  if (/^dsh-deepseek-.*\.json$/i.test(name)) return true;
  if (!/\.json$/i.test(name)) return false;
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.subarray(0, read).toString('utf8').includes('dsh-deepseek-export');
  } catch {
    return false;
  }
}

function newestExport() {
  let latest = null;
  let scanned = 0;
  for (const dir of downloadDirs()) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    scanned += names.length;
    for (const name of names) {
      if (!looksLikeExport(path.join(dir, name))) continue;
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        if (!latest || stat.mtimeMs > latest.mtimeMs) latest = { full, mtimeMs: stat.mtimeMs };
      } catch {
        /* 跳过读不到的文件 */
      }
    }
  }
  return { latest, dirs: downloadDirs(), scanned };
}

/** 没给文件时自动挑下载目录里最新的导出；返回是否成功 */
function autoPickFile() {
  const found = newestExport();
  if (!found.latest) {
    console.error('用法：node dsh-import.mjs <导出文件或目录> [--workspace <路径>]');
    console.error('（也可以把文件拖到 导入到DSH.cmd 上）');
    console.error(`\n已查找的下载目录：`);
    for (const dir of found.dirs) console.error(`  ${dir}`);
    if (!found.dirs.length) console.error('  （一个都没找到，Downloads 可能被重定向或不存在）');
    console.error(`\n文件名需要是 dsh-deepseek-*.json（共扫描 ${found.scanned} 个文件）`);
    return false;
  }
  console.log(`未指定文件，使用最新的导出：${found.latest.full}`);
  opts.files.push(found.latest.full);
  return true;
}

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions');
const WORKSPACE_STORE = path.join(DSH_HOME, 'storages', 'workspace.json');

// ---------------------------------------------------------------- 工具

function readJson(file) {
  // 去掉可能的 UTF-8 BOM（记事本 / PowerShell 写的文件常带）
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

// ---------------------------------------------------------------- 工作区

function readWorkspaceStore() {
  if (!fs.existsSync(WORKSPACE_STORE)) throw new Error(`找不到 ${WORKSPACE_STORE}，DSH 可能还没初始化过工作区`);
  return readJson(WORKSPACE_STORE);
}

/**
 * 写回 workspace.json 前先自检字段，并通过备份回滚。
 *
 * DSH 对工作区条目要求 path/title/sessionIds/createdAt/updatedAt 齐全；
 * 少一个字段整个文件都会校验失败，DSH 连主窗口都起不来。这里把它变成
 * 「写入前拦截 + 自动回滚」，避免再出现 0.2.5 那种把用户挡在门外的情况。
 */
function commitWorkspaceStore(store, backup, label) {
  const required = ['path', 'title', 'sessionIds', 'createdAt', 'updatedAt'];
  for (const [id, ws] of Object.entries(store?.tables?.workspaces ?? {})) {
    const missing = required.filter((key) => !(key in ws));
    if (missing.length) {
      fs.copyFileSync(backup, WORKSPACE_STORE);
      console.error(`workspace.json 自检失败：工作区 ${id} 缺字段 ${missing.join(', ')}`);
      console.error(`已从备份回滚：${path.basename(backup)}`);
      process.exit(1);
    }
  }
  fs.writeFileSync(WORKSPACE_STORE, JSON.stringify(store, null, 2) + '\n');
  if (label) console.log(label);
}

function listWorkspaces(store) {
  const table = store?.tables?.workspaces ?? {};
  return Object.entries(table).map(([id, ws]) => ({
    id,
    path: ws.path,
    title: ws.title || path.basename(ws.path || ''),
    sessionCount: (ws.sessionIds || []).length,
  }));
}

async function pickWorkspace(workspaces) {
  if (opts.workspace) {
    const wanted = path.resolve(opts.workspace).toLowerCase();
    const hit = workspaces.find((ws) => (ws.path || '').toLowerCase() === wanted);
    if (hit) return hit;

    // 目录存在就自动注册：DSH 只在启动时读 workspace.json，所以仍需重启才可见，
    // 但用户不必再为了「导入到一个新目录」先去界面里加一次工作区。
    const abs = path.resolve(opts.workspace);
    if (!fs.existsSync(abs)) {
      // 允许直接指定一个还不存在的目录，导入时顺手建出来（相当于 mkdir -p）
      fs.mkdirSync(abs, { recursive: true });
      console.log(`  已创建目录：${abs}`);
    }
    const id = crypto.randomUUID();
    const backup = `${WORKSPACE_STORE}.bak-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
    fs.copyFileSync(WORKSPACE_STORE, backup);
    const store = readJson(WORKSPACE_STORE);
    store.tables = store.tables || {};
    store.tables.workspaces = store.tables.workspaces || {};
    store.tables.workspaces[id] = {
      path: abs,
      title: path.basename(abs),
      sessionIds: [],
      // DSH 的 workspace schema 要求 createdAt 与 updatedAt 同时存在。
      // 少任意一个，整个 workspace.json 校验失败，DSH 窗口直接起不来。
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.global = store.global || {};
    store.global.workspaceIds = Array.isArray(store.global.workspaceIds) ? store.global.workspaceIds : [];
    if (!store.global.workspaceIds.includes(id)) store.global.workspaceIds.push(id);
    commitWorkspaceStore(store, backup, `  已自动注册新工作区：${abs}（备份 ${path.basename(backup)}）`);
    return { id, path: abs, title: path.basename(abs), sessionCount: 0 };
  }
  if (workspaces.length === 1) return workspaces[0];

  console.log('选择要导入到哪个 DSH 工作区：');
  workspaces.forEach((ws, i) => console.log(`  [${i + 1}] ${ws.title}  ${ws.path}  (${ws.sessionCount} 个会话)`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`序号 [1-${workspaces.length}]，回车默认 1：`);
  rl.close();
  const index = Math.min(Math.max(parseInt(answer.trim() || '1', 10) - 1, 0), workspaces.length - 1);
  return workspaces[index];
}

// ---------------------------------------------------------------- 读取导出

function expandFiles(inputs) {
  const out = [];
  for (const input of inputs) {
    const abs = path.resolve(input);
    if (!fs.existsSync(abs)) {
      console.error(`跳过不存在的路径：${abs}`);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(abs)) {
        if (/\.json$/i.test(name)) out.push(path.join(abs, name));
      }
    } else out.push(abs);
  }
  return out;
}

/** 返回 { list, options }：options 是导出时带的导入默认值（可被命令行覆盖） */
function conversationsOf(file) {
  const raw = readJson(file);
  const options = raw && !Array.isArray(raw) ? raw.options ?? null : null;

  if (raw?.format === 'dsh-deepseek-export' && Array.isArray(raw.conversations)) return { list: raw.conversations, options };
  if (Array.isArray(raw?.conversations)) return { list: raw.conversations, options };
  if (Array.isArray(raw?.messages)) {
    return { list: [{ id: path.basename(file, '.json'), title: path.basename(file, '.json'), messages: raw.messages }], options };
  }
  if (Array.isArray(raw)) {
    return { list: [{ id: path.basename(file, '.json'), title: path.basename(file, '.json'), messages: raw }], options };
  }

  // 兼容 DeepSeek 网页/App 的原始响应
  const biz = raw?.data?.biz_data ?? raw?.biz_data;
  const msgs = biz?.chat_messages;
  if (Array.isArray(msgs) && msgs.length) {
    return {
      options,
      list: [
        {
          id: biz.chat_session?.id ?? path.basename(file, '.json'),
          title: biz.chat_session?.title ?? path.basename(file, '.json'),
          messages: msgs.map((m) => ({
            role: /USER/i.test(String(m.role)) ? 'user' : 'assistant',
            content: typeof m.content === 'string' ? m.content : '',
            thinking: m.thinking_content ?? '',
            files: Array.isArray(m.files) ? m.files.map((f) => ({ name: f.file_name ?? 'file', url: f.url ?? null })) : [],
          })),
        },
      ],
    };
  }
  throw new Error(`${file}：无法识别的导出格式（既不是 dsh-deepseek-export，也没有 chat_messages）`);
}

// ---------------------------------------------------------------- 生成会话

const IMPORT_SYSTEM_NOTE =
  '本会话的历史来自 DeepSeek 网页对话的导入，以下消息为用户与助手的原始记录，顺序与原文一致。';

const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;
const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/zip': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

function humanSize(bytes) {
  if (typeof bytes !== 'number') return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 旁挂文件放哪：默认在工作区里，可改到别处 */
function sidecarRoot(workspacePath) {
  if (opts.noSidecar) return path.join(DSH_HOME, 'import-archive');
  if (opts.sidecarDir) return path.resolve(opts.sidecarDir);
  return path.join(workspacePath, '.dsh-imported');
}

/** 正文里引用的显示路径：在工作区内就写相对路径，否则写绝对路径 */
function sidecarLabelFor(workspacePath, sessionId) {
  const full = path.join(sidecarRoot(workspacePath), sessionId);
  const rel = path.relative(workspacePath, full);
  const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  return (inside ? rel : full).split(path.sep).join('/');
}

/**
 * 会话的旁挂目录：默认 <工作区>/.dsh-imported/<sessionId>/
 * 落在工作区时顺手放一个自忽略的 .gitignore，
 * 这样导入不会在用户仓库的 git status 里刷出一堆未跟踪文件。
 */
function sidecarDir(workspacePath, sessionId) {
  const root = sidecarRoot(workspacePath);
  const dir = path.join(root, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  if (path.resolve(root) === path.resolve(path.join(workspacePath, '.dsh-imported'))) {
    const ignore = path.join(root, '.gitignore');
    if (!fs.existsSync(ignore)) {
      try {
        fs.writeFileSync(ignore, '# DSH 导入存档（思考 / 全文 / 多版本；数据源带引用或附件时另存）\n*\n');
      } catch {
        /* 没有写权限就算了 */
      }
    }
  }
  return dir;
}

/**
 * 把附件落盘。拿到 dataUrl 就写文件；只拿到名字/大小/链接时，
 * 退化成一条可检索的记录，交给人自己在本机匹配。
 */
function saveAttachments(files, workspacePath, sessionId) {
  if (!files.length || opts.dryRun) return [];
  const dir = sidecarDir(workspacePath, sessionId);
  const lines = [];
  const used = new Set();

  files.forEach((file, index) => {
    // 搜索结果里的站点图标：名字是通用 "image"、类型是二进制、体积极小
    const genericName = !file.name || file.name === 'image' || file.name === 'icon';
    const binaryMime = !file.mime || file.mime === 'binary/octet-stream' || file.mime === 'application/octet-stream';
    if (genericName && binaryMime && (file.size ?? 0) < 4096) return;

    const match = typeof file.dataUrl === 'string' ? file.dataUrl.match(DATA_URL) : null;

    if (!match) {
      const size = humanSize(file.size);
      const label = `${file.name || '附件'}${size ? `（${size}）` : ''}`;
      lines.push(`[附件未下载：${label}${file.url ? ` 原链接：${file.url}` : ''}]`);
      return;
    }

    fs.mkdirSync(dir, { recursive: true });
    const mime = match[1] || file.mime || 'application/octet-stream';
    const ext =
      MIME_EXT[mime] ||
      (typeof file.name === 'string' && file.name.match(/\.([a-z0-9]{1,6})$/i)?.[1]) ||
      'bin';
    const base =
      String(file.name || `attachment-${index + 1}`)
        .replace(/\.[a-z0-9]{1,6}$/i, '')
        .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
        .slice(0, 60) || `attachment-${index + 1}`;

    // 同一条会话里多条消息都可能带附件：磁盘上已存在就换个后缀，
    // 否则「每条消息都从 01 开始」会互相覆盖。
    let name = `${String(index + 1).padStart(2, '0')}-${base}.${ext}`;
    let counter = 1;
    while (used.has(name) || fs.existsSync(path.join(dir, name))) {
      name = `${String(index + 1).padStart(2, '0')}-${base}-${counter++}.${ext}`;
    }
    used.add(name);

    const target = path.join(dir, name);
    fs.writeFileSync(target, Buffer.from(match[2], 'base64'));
    lines.push(`[附件已保存：${target}]`);
  });

  return lines;
}

/**
 * 编辑提问 / 重新生成会产生树结构：同一个 parent 下、同角色的多条消息
 * 是同一处的多个版本。会话正文只保留当前分支（最后一条），
 * 其余版本交给 revisions.md 存档。
 */
function collapseVersions(messages) {
  const groups = new Map();
  const ordered = [];
  messages.forEach((message, index) => {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    // 没有 parentId 的导出（老捕获 / 别的工具生成）无法判重，
    // 每条各自成组，保持原来的线性行为。
    const key =
      message.parentId === null || message.parentId === undefined
        ? `#${index}|${role}`
        : `${message.parentId}|${role}`;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(message);
      existing.active = message;
    } else {
      const group = { role, key, entries: [message], active: message };
      groups.set(key, group);
      ordered.push(group);
    }
  });
  return {
    active: ordered.map((group) => group.active),
    versions: ordered.filter((group) => group.entries.length > 1),
  };
}

function writeRevisions(conversation, workspacePath, sessionId, versions) {
  if (opts.dryRun || !versions.length) return null;
  const dir = sidecarDir(workspacePath, sessionId);
  const file = path.join(dir, 'revisions.md');
  const head = [
    '# 多版本存档',
    '',
    `- 会话：${conversation.title || '未命名对话'}`,
    `- 多版本处：${versions.length} 处`,
    `- 导出时间：${new Date().toISOString()}`,
    '',
    '> 会话正文只保留当前分支；下面是每次编辑 / 重新生成留下的所有版本。',
    '',
    '',
  ].join('\n');

  let index = 0;
  const body = versions
    .map((group) => {
      index += 1;
      const blocks = group.entries.map((entry, i) => {
        const active = entry === group.active;
        const time = entry.time ? new Date(entry.time).toLocaleString('zh-CN') : '时间未知';
        const label = `### 版本 ${i + 1}${active ? '（当前）' : '（已放弃）'} · ${time}`;
        const full = String(entry.content || '');
        const quoted = full
          .slice(0, 20000)
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n');
        const truncated = full.length > 20000 ? '\n>\n> …（已截断，原文见导出 JSON）' : '';
        return `${label}\n\n${quoted}${truncated}`;
      });
      return `## 第 ${index} 处 · ${group.role === 'user' ? '用户提问' : '助手回答'}\n\n${blocks.join('\n\n')}`;
    })
    .join('\n\n');

  fs.writeFileSync(file, `${head}${body}\n`);
  return file;
}

function writeReferences(conversation, workspacePath, sessionId, entries) {
  if (opts.dryRun || !entries.length) return null;
  const dir = sidecarDir(workspacePath, sessionId);
  const file = path.join(dir, 'references.md');
  const head = [
    '# 联网搜索引用',
    '',
    `- 会话：${conversation.title || '未命名对话'}`,
    `- 带引用的消息：${entries.length} 条`,
    `- 导出时间：${new Date().toISOString()}`,
    '',
    '> 正文里的 [reference:N] 已按编号还原成链接；这里是完整清单。',
    '',
    '',
  ].join('\n');
  const body = entries
    .map((entry) => {
      const lines = entry.references
        .map((ref, index) => `- [${index + 1}] ${ref.title ? `${ref.title} — ` : ''}${ref.url}`)
        .join('\n');
      return `## 消息 #${entry.messageIndex}（${entry.role}）\n\n${lines}`;
    })
    .join('\n\n');
  fs.writeFileSync(file, `${head}${body}\n`);
  return file;
}

function writeThinking(conversation, workspacePath, sessionId, entries) {
  if (opts.dryRun || !entries.length) return null;
  const dir = sidecarDir(workspacePath, sessionId);
  const file = path.join(dir, 'thinking.md');
  const head = [
    '# 思考过程存档',
    '',
    `- 会话：${conversation.title || '未命名对话'}`,
    `- 消息数：${(conversation.messages || []).length}`,
    `- 导出时间：${new Date().toISOString()}`,
    '',
    '> 仅供查阅，不进入对话上下文。',
    '',
    '',
  ].join('\n');
  const body = entries
    .map((entry) => {
      const time = entry.time ? new Date(entry.time).toLocaleString('zh-CN') : '时间未知';
      const quoted = String(entry.thinking)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return `## #${entry.index} ${entry.role} · ${time}\n\n${quoted}\n`;
    })
    .join('\n');
  fs.writeFileSync(file, head + body);
  return file;
}

function buildEvents(conversation, workspacePath, sessionId) {
  const events = [];
  const thinking = [];
  const references = [];
  const collapsed = collapseVersions(conversation.messages || []);
  // --keep-all：不合并编辑前的旧版本，按原顺序全部保留（会看到同一处多个提问/回答）
  const active = opts.keepAll ? (conversation.messages || []) : collapsed.active;
  const versions = opts.keepAll ? [] : collapsed.versions;
  let seq = 0;
  let clock = Date.now();
  const push = (type, data, extra) => events.push({ type, seq: seq++, time: clock++, data, ...extra });

  // 旁挂文件的索引：写进第一条用户消息，模型按需读取时知道去哪找
  const thinkingCount = (conversation.messages || []).filter((m) => m.thinking && m.thinking.trim()).length;
  const attachmentCount = (conversation.messages || []).reduce((sum, m) => sum + (m.files || []).length, 0);
  const sidecarParts = [];
  const sidecarLabel = sidecarLabelFor(workspacePath, sessionId);
  if (thinkingCount) sidecarParts.push(`思考 ${thinkingCount} 段 → ${sidecarLabel}/thinking.md`);
  if (versions.length) sidecarParts.push(`多版本 ${versions.length} 处 → ${sidecarLabel}/revisions.md`);
  if (attachmentCount) sidecarParts.push(`附件 → ${sidecarLabel}/`);
  const referenceCount = (conversation.messages || []).reduce((sum, m) => sum + (m.references?.length || 0), 0);
  if (referenceCount) sidecarParts.push(`联网引用 ${referenceCount} 条 → ${sidecarLabel}/references.md`);
  const sidecarNote =
    sidecarParts.length || opts.tailNote
      ? `\n\n[导入存档（需要时可直接读取）：${sidecarParts.join('；')}]${opts.tailNote || ''}`
      : '';

  push('permission/preset', { preset: 'workspace-write' });
  push('sandbox/mode', { mode: 'workspace-write' });
  push('approval/policy', { policy: 'ask' });
  push('session/end-seed', {});

  let turn = 0;
  let step = 0;
  let open = false;
  let firstUserSeq;
  let interruptedCount = 0;

  for (const message of active) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const attachments = saveAttachments(message.files || [], workspacePath, sessionId);
    let text = typeof message.content === 'string' ? message.content.trim() : '';

    // 「搜索到 N 个网页」是搜索状态文案；末尾那句是固定免责声明，都不属于回答
    text = text.replace(/^(?:搜索到\s*\d+\s*个网页)+/, '').trim();
    text = text
      .replace(/\s*本回答由\s*AI\s*生成[，,、\s]*内容仅供参考[，,、\s]*请仔细甄别[。.!！]?\s*$/i, '')
      .replace(/\s*本回答由\s*AI\s*生成[，,、\s]*内容仅供参考[，,、\s]*请仔细甄别[。.!！]?/gi, '')
      .trim();

    // [reference:N] → 可点击的编号链接，并把完整清单收进 references.md
    if (Array.isArray(message.references) && message.references.length) {
      text = text.replace(/\[reference:(\d+)\]/g, (whole, raw) => {
        const ref = message.references[Number(raw)];
        return ref?.url ? `[${Number(raw) + 1}](${ref.url})` : `[${raw}]`;
      });
      references.push({ messageIndex: references.length + 1, role, messageId: message.messageId ?? null, references: message.references });
    }

    if (attachments.length) text += `${text ? '\n\n' : ''}${attachments.join('\n')}`;
    if (message.thinking) {
      thinking.push({ index: thinking.length + 1, role, time: message.time, thinking: message.thinking });
    }

    // 被手动中止的输出：默认只留一个带编号的占位符，正文/思考另存；
    // 加 --keep-interrupted 才保留原始（可能不完整的）正文。
    const looksInterrupted =
      role === 'assistant' &&
      ((message.status && message.status !== 'FINISHED') || message.incomplete === true || !text);
    if (looksInterrupted && (!opts.keepInterrupted || !text)) {
      interruptedCount += 1;
      const id = message.messageId === null || message.messageId === undefined ? '' : ` #${message.messageId}`;
      text = `[中断输出${id}：未产生完整正文${message.thinking ? '，思考过程见 thinking.md' : ''}]`;
    }

    if (!text) continue;

    if (role === 'user') {
      if (open) {
        push('turn/end', { turn, reason: { kind: 'completed' } });
        open = false;
      }
      turn += 1;
      step = 1;
      push('turn/start', { turn });
      // 第一轮就写上路由与容量：上下文圆环靠它显示容量，
      // 用量由 token-meter 回放日志估算，不需要伪造 usage。
      if (turn === 1) {
        push('request/context', {
          provider: opts.provider || 'deepseek-account',
          model: opts.model || 'deepseek-flash',
          // 只在显式指定时写容量，否则交给路由自己解析，避免写死错数字
          ...(Number(opts.contextWindow) ? { contextWindow: Number(opts.contextWindow) } : {}),
        });
      }
      push('step/start', { turn, step });
      // v4 不变量：surface 的第 0 个节点必须是受保护的 system 头。
      // 导入的历史前面没有 system/message 时，会话能打开，但一旦继续对话、
      // 运行时追加自己的 system/message 就会被校验器判为损坏。
      if (turn === 1 && !opts.noSystemHead) {
        push('system/message', {
          turn,
          step,
          message: {
            role: 'system',
            content: [{ type: 'text', text: IMPORT_SYSTEM_NOTE }],
            source: { kind: 'system-prompt' },
            id: crypto.randomUUID(),
          },
        }, { surfaceOp: 'append' });
      }
      const seqNow = seq;
      // 只在第一条用户消息尾部附上存档索引
      if (sidecarNote && firstUserSeq === undefined) text += sidecarNote;
      push(
        'user/message',
        {
          content: [{ type: 'text', text }],
          source: { kind: 'user', rpcId: crypto.randomUUID(), clientTimeZone: 'Asia/Shanghai' },
          role: 'user',
          id: crypto.randomUUID(),
        },
        { surfaceOp: 'append' }
      );
      if (firstUserSeq === undefined) firstUserSeq = seqNow;
      push('step/end', { turn, step });
      open = true;
    } else {
      if (!open) {
        turn += 1;
        push('turn/start', { turn });
        open = true;
      }
      step += 1;
      push('step/start', { turn, step });
      const blocks = [{ type: 'text', text }];
      // 思考过程不进上下文，统一写到 thinking.md 旁挂文件
      if (opts.thinking && message.thinking) {
        const quoted = String(message.thinking)
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n');
        blocks.unshift({ type: 'text', text: `> 思考过程\n${quoted}\n` });
      }
      push(
        'assistant/message',
        {
          turn,
          step,
          message: {
            role: 'assistant',
            content: blocks,
            source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-flash' },
            id: crypto.randomUUID(),
          },
          stream: [],
        },
        { surfaceOp: 'append' }
      );
      push('step/end', { turn, step });
    }
  }
  if (open) push('turn/end', { turn, reason: { kind: 'completed' } });

  if (firstUserSeq !== undefined) {
    events.push({
      type: 'session/title',
      seq: seq++,
      time: clock++,
      data: {
        title: String(conversation.title || '导入的对话').slice(0, 60),
        messageSeqs: [firstUserSeq],
        source: { kind: 'fallback' },
      },
    });
  }
  return { events, thinking, versions, interruptedCount, references };
}

function encodeSession(events, header) {
  const frames = [zlib.zstdCompressSync(Buffer.from(JSON.stringify(header) + '\n', 'utf8'))];
  for (const event of events) {
    frames.push(zlib.zstdCompressSync(Buffer.from(JSON.stringify(event) + '\n', 'utf8')));
  }
  return Buffer.concat(frames);
}

function verifyFile(file) {
  const buf = fs.readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const offsets = [];
  for (let i = -1; (i = buf.indexOf(magic, i + 1)) !== -1;) offsets.push(i);
  let text = '';
  for (let k = 0; k < offsets.length; k++) {
    text += zlib.zstdDecompressSync(buf.slice(offsets[k], offsets[k + 1] ?? buf.length)).toString('utf8');
  }
  const rows = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const header = rows[0];
  const events = rows.slice(1);
  const dense = events.every((event, index) => event.seq === index);
  return { header, events, dense };
}

function projectDir(workspacePath) {
  return `--${workspacePath.replace(/[\\/:]+/g, '-')}--`;
}

/** 只保留最后 N 轮；还可以给一个字符预算，从最后一条往前累加到超预算为止 */
function trimToTail(messages, turns, maxChars = 0) {
  const userIndexes = messages.map((message, index) => (message.role === 'user' ? index : -1)).filter((i) => i >= 0);
  if (userIndexes.length <= 1 && !maxChars) return { messages, trimmed: 0 };

  const turnStarts = userIndexes.slice(-turns);
  let start = turnStarts[0] ?? 0;

  if (maxChars > 0) {
    let used = 0;
    let budgetStart = messages.length;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      used += (message.content || '').length + (message.thinking || '').length;
      budgetStart = i;
      // 至少保留最后一轮，避免预算太小把整段裁空
      if (used >= maxChars && message.role === 'user') break;
    }
    start = Math.max(start, budgetStart);
  }

  if (start === 0) return { messages, trimmed: 0 };
  return { messages: messages.slice(start), trimmed: start };
}

/** 完整对话记录（旁挂），截断导入时用来兜底查阅；文首带索引便于 grep */
function writeTranscript(conversation, workspacePath, sessionId) {
  if (opts.dryRun) return null;
  const dir = sidecarDir(workspacePath, sessionId);
  const file = path.join(dir, 'transcript.md');
  const messages = conversation.messages || [];

  const firstLineOf = (text) => {
    const line = String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !/^#{1,6}\s/.test(l));
    return (line || '（空）').slice(0, 40);
  };

  const index = messages.map((message, i) => {
    const role = message.role === 'assistant' ? '助手' : '用户';
    const chars = (message.content || '').length;
    return `- #${i + 1} ${role} ${chars} 字 — ${firstLineOf(message.content)}`;
  });

  const head = [
    '# 完整对话记录',
    '',
    `- 会话：${conversation.title || '未命名对话'}`,
    `- 消息数：${messages.length}`,
    `- 导出时间：${new Date().toISOString()}`,
    '',
    '> 这是未截断的原文，供检索用；会话正文可能只包含最后若干轮。',
    '> 用法：用 `## #N` 定位单条（例如 grep "## #123"），索引里的编号与之对应。',
    '',
    '## 索引',
    '',
    ...index,
    '',
  ].join('\n');

  const body = messages
    .map((message, index2) => {
      const role = message.role === 'assistant' ? '助手' : '用户';
      const time = message.time ? new Date(message.time).toLocaleString('zh-CN') : '';
      const parts = [`## #${index2 + 1} ${role}${time ? ` · ${time}` : ''}`, ''];
      if (message.thinking) {
        parts.push('> 思考：', ...String(message.thinking).split('\n').map((line) => `> ${line}`), '');
      }
      parts.push(String(message.content || '').trim() || '（空）', '');
      return parts.join('\n');
    })
    .join('\n');

  fs.writeFileSync(file, `${head}${body}`);
  return file;
}

// ---------------------------------------------------------------- 主流程

/**
 * 确保当前用户在目标工作区上拥有「完全控制」。
 *
 * 为什么需要：DSH 沙箱每次运行都要往工作区写一条针对本次受限 SID 的授权，
 * 这要求目录本身带 WRITE_DAC / WRITE_OWNER。而新建的目录通常只从父目录继承
 * 「Authenticated Users: 修改」——不含这两项——于是授权写入直接失败
 * （SetNamedSecurityInfoW Win32 5），表现为打开会话后所有命令都报 grantWrite。
 *
 * 导入时顺手补一条可继承的完全控制，用户就不必先撞一次错误再回来修。
 * 这是用户自己的进程在跑，不是受限令牌，所以能改（目录 owner 有隐式 WRITE_DAC）。
 */
function ensureWorkspaceAcl(dir) {
  if (process.platform !== 'win32' || opts.noAclFix) return;
  try {
    const user = execFileSync('whoami', { encoding: 'utf8' }).trim();
    const listing = execFileSync('icacls', [dir], { encoding: 'utf8' });
    const already = listing
      .split('\n')
      .some((line) => line.toUpperCase().includes(user.toUpperCase()) && /\(F\)/.test(line));
    if (already) return;
    execFileSync('icacls', [dir, '/grant', `${user}:(OI)(CI)F`], { stdio: 'ignore' });
    console.log(`  已为工作区补写完全控制权限（DSH 沙箱需要）：${dir}`);
  } catch (error) {
    console.warn(`  无法自动补写工作区权限：${error.message}`);
    console.warn(`  若打开会话时报 grantWrite，请手动执行：`);
    console.warn(`    icacls "${dir}" /grant "${process.env.USERNAME}:(OI)(CI)F"`);
  }
}

async function main() {
  if (opts.doctor) {
    const { runDoctor } = await import('./doctor.mjs');
    const result = runDoctor({ json: opts.json === true });
    return { doctor: result };
  }

  if (opts.audit) {
    const { auditSessions } = await import('./repair-session.mjs');
    auditSessions({ dryRun: opts.dryRun, apply: opts.applyRepair === true });
    return { audited: true };
  }

  // ---------- 参数自检：互相排斥的组合直接拒绝 ----------
  if (opts.tail !== undefined && opts.tail !== null) {
    if (!Number.isInteger(opts.tail) || opts.tail < 1) {
      console.error(`--tail 需要正整数，收到：${opts.tail}`);
      process.exit(1);
    }
    if (opts.fromIndex != null || opts.fromMatch) {
      console.error('--tail 和 --from-index/--from-match 不能同时用：前者取最后 N 轮，后者从指定消息开始。');
      process.exit(1);
    }
  }
  if (opts.fromIndex != null && (!Number.isInteger(opts.fromIndex) || opts.fromIndex < 0)) {
    console.error(`--from-index 需要非负整数，收到：${opts.fromIndex}`);
    process.exit(1);
  }
  if (opts.fromMatch !== undefined && opts.fromMatch !== null && !String(opts.fromMatch).trim()) {
    console.error('--from-match 需要一个非空关键词。');
    process.exit(1);
  }

  if (opts.setDir) {
    const saved = saveConfig({ downloadDir: path.resolve(opts.setDir) });
    console.log(`已把下载目录记为：${saved.downloadDir}`);
  }
  if (opts.dir) config = { ...getConfig(), downloadDir: path.resolve(opts.dir) };
  if (opts.lang) config = { ...getConfig(), lang: opts.lang === 'en' ? 'en' : 'zh' };

  if (!opts.files.length && !opts.list && !autoPickFile()) {
    process.exit(1);
  }
  const store = readWorkspaceStore();
  const workspaces = listWorkspaces(store);
  if (opts.list) {
    console.log('DSH 工作区：');
    for (const ws of workspaces) console.log(`  ${ws.title}\t${ws.path}\t(${ws.sessionCount} 个会话)`);
    return { workspaces };
  }
  if (!workspaces.length) {
    console.error('workspace.json 里没有任何工作区，请先在 DSH 里打开一个目录');
    process.exit(1);
  }

  const target = await pickWorkspace(workspaces);
  if (!fs.existsSync(target.path)) {
    console.error(`工作区目录不存在：${target.path}`);
    process.exit(1);
  }

  ensureWorkspaceAcl(target.path);

  const files = expandFiles(opts.files);
  if (!files.length) {
    console.error('没有找到可导入的 .json 文件');
    process.exit(1);
  }

  let conversations = [];
  let exportOptions = null;
  for (const file of files) {
    try {
      const parsed = conversationsOf(file);
      if (!exportOptions && parsed.options) exportOptions = parsed.options;
      for (const conversation of parsed.list) {
        if (!conversation.messages?.length) {
          console.warn(`跳过空对话：${conversation.title || conversation.id}（${file}）`);
          continue;
        }
        conversations.push(conversation);
      }
    } catch (error) {
      console.error(`读取失败 ${file}：${error.message}`);
    }
  }
  if (opts.only?.length) {
    const wanted = new Set(opts.only);
    const before = conversations;
    conversations = conversations.filter((conversation) => wanted.has(conversation.id));
    if (!conversations.length) {
      console.error(`--only 指定的对话一个都没匹配到：${opts.only.join(', ')}`);
      console.error('可用 id：');
      const seen = new Set();
      for (const conversation of before) {
        if (seen.has(conversation.id)) continue;
        seen.add(conversation.id);
        console.error(`  ${conversation.id}  ${conversation.title || ''}`);
      }
      process.exit(1);
    }
  }

  // 同一 id 出现在多份导出里：保留最全的一份，其余跳过
  if (conversations.length > 1) {
    const byId = new Map();
    const deduped = [];
    for (const conversation of conversations) {
      const key = conversation.id ?? `anon-${deduped.length}`;
      const previous = byId.get(key);
      if (!previous) {
        byId.set(key, conversation);
        deduped.push(conversation);
        continue;
      }
      const keep = conversation.messages.length > previous.messages.length ? conversation : previous;
      if (keep !== previous) deduped[deduped.indexOf(previous)] = keep;
      byId.set(key, keep);
      console.log(
        `  重复对话「${conversation.title || conversation.id}」：保留 ${keep.messages.length} 条的那份，跳过 ${keep === previous ? conversation.messages.length : previous.messages.length} 条的`
      );
    }
    conversations = deduped;
  }

  // 分支点只对单个对话有意义
  if ((opts.fromIndex != null || opts.fromMatch) && conversations.length > 1) {
    console.error(`--from-index / --from-match 只适用于单个对话，当前有 ${conversations.length} 个。`);
    console.error('先用 --only <id> 指定其中一个，或分开导入。');
    process.exit(1);
  }

  // 扩展里的「旁挂文件写到 DSH 目录」也随导出文件过来；命令行 --sidecar-dir 优先级更高
  if (!opts.noSidecar && !opts.sidecarDir && exportOptions?.sidecarExternal) opts.noSidecar = true;
  if (!conversations.length) {
    console.error('没有可导入的对话（注意：DeepSeek 的 chat_messages 为空时无法重建）');
    process.exit(1);
  }

  console.log(`\n目标工作区：${target.title}  ${target.path}`);
  console.log(`待导入对话：${conversations.length} 个\n`);

  const created = [];
  for (const conversation of conversations) {
    const sessionId = `session-${crypto.randomUUID()}`;
    const allMessages = conversation.messages || [];
    const totalChars = allMessages.reduce((sum, m) => sum + (m.content || '').length, 0);

    // 指定分支点：从某条消息开始，而不是从最后 N 轮
    let branchIndex = Number.isInteger(opts.fromIndex) ? opts.fromIndex : null;
    if (branchIndex === null && opts.fromMatch) {
      const needle = String(opts.fromMatch).toLowerCase();
      const found = allMessages.findIndex(
        (m) => m.role === 'user' && String(m.content || '').toLowerCase().includes(needle)
      );
      if (found >= 0) branchIndex = found;
      else console.warn(`  没找到包含「${opts.fromMatch}」的用户消息，改为从头导入`);
    }

    let originalMessages = allMessages;
    let branchNote = '';
    if (branchIndex !== null && branchIndex > 0 && branchIndex < allMessages.length) {
      originalMessages = allMessages.slice(branchIndex);
      const firstUser = originalMessages.findIndex((m) => m.role === 'user');
      if (firstUser > 0) originalMessages = originalMessages.slice(firstUser);
      branchNote = `\n\n[导入说明：这是原对话的第 ${branchIndex + 1} 条之后的分支；完整原文见 ${sidecarLabelFor(target.path, sessionId)}/transcript.md]`;
      console.log(`  从第 ${branchIndex + 1} 条开始分支（${originalMessages.length} 条）`);
    }

    // 优先级：命令行 > 导出时带的 options（扩展设置） > import.config.json
    const cfg = getConfig();
    const effective = {
      autoTrim: opts.autoTrim === false ? false : exportOptions?.autoTrim ?? cfg.autoTrim,
      chars: Number(exportOptions?.autoTrimChars) || cfg.autoTrimChars,
      turns: Number(exportOptions?.autoTrimTurns) || cfg.autoTrimTurns,
      budget: Number(exportOptions?.autoTrimBudget) || cfg.autoTrimBudget,
    };
    // 显式选了分支点就不再自动截断，尊重用户的选择
    const autoTrim = branchNote === '' && effective.autoTrim && !opts.tail && totalChars > effective.chars;
    const tailTurns = opts.tail || (autoTrim ? effective.turns : 0);
    const trimmed = tailTurns
      ? trimToTail(originalMessages, tailTurns, autoTrim ? effective.budget : 0)
      : { messages: originalMessages, trimmed: 0 };
    const working = trimmed.trimmed ? { ...conversation, messages: trimmed.messages } : { ...conversation, messages: originalMessages };
    opts.tailNote = trimmed.trimmed
      ? `\n\n[导入说明：原对话共 ${allMessages.length} 条，这里只导入了最后 ${tailTurns} 轮${
          autoTrim ? `（超过 ${effective.chars} 字的自动截断）` : ''
        }；完整原文见 ${sidecarLabelFor(target.path, sessionId)}/transcript.md]`
      : branchNote;
    if (trimmed.trimmed) {
      console.log(
        `  原对话 ${allMessages.length} 条（${totalChars} 字）→ 只取最后 ${tailTurns} 轮（${trimmed.messages.length} 条）${
          autoTrim ? ' [自动截断]' : ''
        }`
      );
    }

    const built = buildEvents(working, target.path, sessionId);
    const events = built.events;
    if (!events.some((event) => event.type === 'user/message')) {
      console.warn(`跳过「${conversation.title}」：没有用户消息`);
      continue;
    }
    const header = {
      type: 'session',
      version: 4,
      id: sessionId,
      createdAt: typeof conversation.createdAt === 'number' ? conversation.createdAt : Date.now(),
      cwd: target.path,
      isSeeded: false,
      delegationDepth: 0,
      agentPreset: 'standard',
    };
    const dir = path.join(SESSIONS_ROOT, projectDir(target.path), sessionId);
    const file = path.join(dir, 'session.v4.jsonl.zstd');

    if (opts.dryRun) {
      console.log(`[dry-run] ${conversation.title} → ${events.length} 个事件`);
      continue;
    }

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, encodeSession(events, header));
    const check = verifyFile(file);
    if (!check.dense) throw new Error(`生成的会话序号不连续：${file}`);
    const thinkingFile = writeThinking(conversation, target.path, sessionId, built.thinking);
    const revisionsFile = writeRevisions(conversation, target.path, sessionId, built.versions);
    const referencesFile = writeReferences(conversation, target.path, sessionId, built.references);
    // 截断导入或超大对话：额外留一份完整原文，供模型按需检索
    const needTranscript = trimmed.trimmed > 0 || branchNote !== '' || totalChars > 150000;
    const transcriptFile = needTranscript ? writeTranscript(conversation, target.path, sessionId) : null;
    const turns = events.filter((event) => event.type === 'turn/end').length;
    created.push({ sessionId, title: conversation.title, file, turns });
    console.log(`✓ ${conversation.title}  (${check.events.length} 事件, ${turns} 轮)`);
    if (thinkingFile) console.log(`  思考过程 → ${thinkingFile}`);
    if (referencesFile) console.log(`  联网引用 → ${referencesFile}`);
    if (built.interruptedCount) console.log(`  中断输出 ${built.interruptedCount} 条（只留编号占位符，加 --keep-interrupted 可保留原文）`);
    if (revisionsFile) console.log(`  多版本 → ${revisionsFile}`);
    if (transcriptFile) console.log(`  完整原文 → ${transcriptFile}`);
  }

  if (opts.dryRun || !created.length) return { workspace: target, created, dryRun: opts.dryRun };

  if (opts.register) {
    const backup = `${WORKSPACE_STORE}.bak-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
    fs.copyFileSync(WORKSPACE_STORE, backup);
    const fresh = readJson(WORKSPACE_STORE);
    const ws = fresh.tables.workspaces[target.id];
    ws.sessionIds = Array.isArray(ws.sessionIds) ? ws.sessionIds : [];
    for (const item of created) {
      if (!ws.sessionIds.includes(item.sessionId)) ws.sessionIds.push(item.sessionId);
    }
    ws.updatedAt = new Date().toISOString();
    commitWorkspaceStore(fresh, backup, `\n已注册到 workspace.json（备份：${path.basename(backup)}）`);
  }

  console.log(`\n完成：${created.length} 个会话已写入 ${SESSIONS_ROOT}`);
  console.log('请完全退出并重启 DeepSeek Harness（它只在启动时读 workspace.json），然后到左侧该工作区的会话列表里查看。');
  return { workspace: target, created, dryRun: false };
}

/**
 * 供 TUI / 其它程序调用：不解析命令行，直接指定文件与工作区。
 * 返回 { workspace, created }。
 */
export async function runImport({ files, workspacePath = null, dryRun = false, register = true, thinking = false, only = null, keepAll = false, keepInterrupted = false, fromIndex = null, fromMatch = null, tail = null }) {
  opts.files = [...files];
  opts.workspace = workspacePath;
  opts.dryRun = dryRun;
  opts.register = register;
  opts.thinking = thinking;
  opts.only = only;
  opts.keepAll = keepAll;
  opts.keepInterrupted = keepInterrupted;
  opts.fromIndex = fromIndex;
  opts.fromMatch = fromMatch;
  opts.tail = Number.isInteger(tail) && tail > 0 ? tail : undefined;
  opts.list = false;
  opts.json = false;
  return main();
}

/** 供 TUI 复用：读取工作区列表 */
export function getWorkspaces() {
  return listWorkspaces(readWorkspaceStore());
}

export { getConfig, saveConfig };

/** 供 TUI 复用：扫描下载目录里所有导出文件（新的在前） */
export function listExports() {
  const results = [];
  for (const dir of downloadDirs()) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!looksLikeExport(path.join(dir, name))) continue;
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (stat.isFile()) results.push({ file: full, size: stat.size, mtime: stat.mtimeMs });
      } catch {
        /* 跳过 */
      }
    }
  }
  return results.sort((a, b) => b.mtime - a.mtime);
}

/** 只解析导出文件的元信息，不写盘（TUI 预览用） */
export function peekExport(files) {
  const conversations = [];
  for (const file of expandFiles(files)) {
    try {
      const parsed = conversationsOf(file);
      for (const conversation of parsed.list) {
        const messages = conversation.messages || [];
        const firstUser = messages.find((m) => m.role === 'user')?.content || '';
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')?.content || '';
        const shorten = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, 40);
        conversations.push({
          file,
          id: conversation.id ?? null,
          title: conversation.title ?? '未命名对话',
          messages: messages.length,
          messageList: messages,
          chars: messages.reduce((sum, m) => sum + (m.content || '').length, 0),
          thinking: messages.filter((m) => m.thinking && m.thinking.trim()).length,
          attachments: messages.reduce((sum, m) => sum + (m.files || []).length, 0),
          firstUser: shorten(firstUser),
          lastAssistant: shorten(lastAssistant),
        });
      }
    } catch (error) {
      conversations.push({ file, error: String(error?.message ?? error) });
    }
  }
  return conversations;
}

// ---------------------------------------------------------------- 入口

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  parseArgs(process.argv.slice(2));
  main()
    .then((result) => {
      if (opts.json) originalLog(JSON.stringify({ ok: true, ...result }, null, 2));
    })
    .catch((error) => {
      console.error('\n失败：', error?.stack || error);
      if (opts.json) originalLog(JSON.stringify({ ok: false, error: String(error?.message ?? error) }, null, 2));
      process.exitCode = 1;
    });
}
