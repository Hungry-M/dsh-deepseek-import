#!/usr/bin/env node
/**
 * 导入 TUI：选文件 → 预览 → 选对话 → 选工作区 → 导入。
 *
 * 用法：
 *   node dsh-import-tui.mjs
 *
 * 设置（下载目录 / 语言）写在 import.config.json，与 dsh-import.mjs 共用；
 * 扩展的「保存子目录」也是同一个约定：<下载目录>/<子目录>/dsh-deepseek-*.json
 *
 * 给 AI / 程序调用请用 dsh-import.mjs（--json / --dry-run / --workspace / --dir）。
 */

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { listExports, peekExport, getWorkspaces, runImport, getConfig, saveConfig } from './dsh-import.mjs';

const rl = readline.createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY === true });

// 自己排队读行：一次性灌入多行（管道 / 粘贴）时不会丢
const pendingLines = [];
const waiting = [];
let inputClosed = false;

rl.on('line', (text) => {
  if (waiting.length) waiting.shift()(text);
  else pendingLines.push(text);
});
rl.on('close', () => {
  inputClosed = true;
  while (waiting.length) waiting.shift()(null);
});

function readLine() {
  if (pendingLines.length) return Promise.resolve(pendingLines.shift());
  if (inputClosed) return Promise.resolve(null);
  return new Promise((resolve) => waiting.push(resolve));
}

async function ask(question) {
  stdout.write(question);
  const answer = await readLine();
  if (answer === null) {
    stdout.write('\n');
    return '';
  }
  return answer.trim();
}

// ---------------------------------------------------------------- 文案

const TEXT = {
  zh: {
    title: 'DeepSeek → DSH 导入',
    sub: '选择文件 → 预览对话 → 选工作区 → 导入',
    recent: '最近的导出文件',
    pickFile: '选择序号（回车=1），或输入文件路径，s=设置：',
    noExports: '下载目录里没有 dsh-deepseek-*.json',
    preview: '预览',
    pickConvs: '要导入哪些？（all / 1,3 / 1-2，回车=全部）：',
    nonePicked: '没有选中任何对话',
    noConvs: '这个文件里没有对话',
    pickWs: '导入到哪个工作区',
    wsIndex: '序号（回车=1）：',
    noWs: 'workspace.json 里没有工作区，请先在 DSH 里打开一个目录',
    aboutImport: '即将导入',
    to: '到',
    confirm: '确认导入？(Y/n)：',
    canceled: '已取消',
    done: (ws) => `完成。重启 DeepSeek Harness 后可在「${ws}」里看到。`,
    settings: '设置',
    dirPrompt: (dir) => `下载目录（当前：${dir || '未设置'}，回车不改）：`,
    langPrompt: '语言 1=中文 2=English（回车不改）：',
    saved: '已保存',
    thinkingN: (n) => `思考 ${n}`,
    attachN: (n) => `附件 ${n}`,
    head: (m, c) => `${m} 条 · ${c} 字`,
    branchTitle: '从哪条消息开始导入？',    branchHint: (n) => `直接回车 = 从头开始（共 ${n} 条用户消息）`,
    branchPrompt: '输入关键词全文匹配（回车跳过）：',
    branchNoMatch: '没有匹配的消息，改为从头导入',
    branchPick: (n) => `选择序号（回车=1，共 ${n} 条匹配）：`,
    branchChosen: (n) => `已选第 ${n} 条作为分支起点`,
    dupMark: (n) => `（另有 ${n - 1} 份相同导出）`,
    firstAsk: '首问：',
    lastAnswer: '末答：',
  },
  en: {
    title: 'DeepSeek → DSH Import',
    sub: 'Pick a file → preview → pick workspace → import',
    recent: 'Recent exports',
    pickFile: 'Index (Enter=1), a file path, or s=settings: ',
    noExports: 'No dsh-deepseek-*.json in the download folder',
    preview: 'Preview',
    pickConvs: 'Which ones? (all / 1,3 / 1-2, Enter=all): ',
    nonePicked: 'Nothing selected',
    noConvs: 'No conversations in this file',
    pickWs: 'Target workspace',
    wsIndex: 'Index (Enter=1): ',
    noWs: 'No workspace in workspace.json; open a folder in DSH first',
    aboutImport: 'About to import',
    to: 'to',
    confirm: 'Proceed? (Y/n): ',
    canceled: 'Cancelled',
    done: (ws) => `Done. Restart DeepSeek Harness to see it under "${ws}".`,
    settings: 'Settings',
    dirPrompt: (dir) => `Download folder (current: ${dir || 'unset'}, Enter to keep): `,
    langPrompt: 'Language 1=中文 2=English (Enter to keep): ',
    saved: 'Saved',
    thinkingN: (n) => `thinking ${n}`,
    attachN: (n) => `files ${n}`,
    head: (m, c) => `${m} msgs · ${c} chars`,
    branchTitle: 'Start from which message?',
    branchHint: (n) => `Enter = from the beginning (${n} user messages)`,
    branchPrompt: 'Keyword to match in messages (Enter to skip): ',
    branchNoMatch: 'No match; importing from the beginning',
    branchPick: (n) => `Index (Enter=1, ${n} matches): `,
    branchChosen: (n) => `Branch starts at message #${n}`,
    dupMark: (n) => `(${n - 1} duplicate exports)`,
    firstAsk: 'First ask: ',
    lastAnswer: 'Last answer: ',
  },
};

let config = getConfig();
let lang = config.lang === 'en' ? 'en' : 'zh';
const t = (key, ...args) => {
  const value = TEXT[lang][key] ?? TEXT.zh[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
};

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function rule(char = '─', width = 64) {
  return char.repeat(width);
}

function banner() {
  console.log('');
  console.log(`${C.bold}┌${rule()}┐${C.reset}`);
  console.log(`${C.bold}│${C.reset}  ${t('title')}${' '.repeat(Math.max(0, 62 - t('title').length))}${C.bold}│${C.reset}`);
  console.log(`${C.bold}└${rule()}┘${C.reset}`);
  console.log(`${C.dim}  ${t('sub')}${C.reset}\n`);
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseSelection(input, max) {
  const text = input.trim().toLowerCase();
  if (!text || text === 'all' || text === '*') return Array.from({ length: max }, (_, i) => i + 1);
  const picked = new Set();
  for (const part of text.split(/[,，\s]+/)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
      for (let i = from; i <= Math.min(to, max); i++) picked.add(i);
      continue;
    }
    const value = Number(part);
    if (Number.isInteger(value) && value >= 1 && value <= max) picked.add(value);
  }
  return [...picked].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- 设置

async function settingsMenu() {
  console.log(`\n${C.bold}${t('settings')}${C.reset}`);
  const dir = await ask(t('dirPrompt', config.downloadDir));
  if (dir) config = saveConfig({ downloadDir: path.resolve(dir.replace(/^["']|["']$/g, '')) });
  const which = await ask(t('langPrompt'));
  if (which === '1' || which === '2') {
    lang = which === '2' ? 'en' : 'zh';
    config = saveConfig({ lang });
  }
  console.log(`${C.green}${t('saved')}${C.reset}\n`);
}

// ---------------------------------------------------------------- 步骤

async function chooseFile() {
  const exports = listExports().slice(0, 10);
  if (exports.length) {
    console.log(`${C.bold}${t('recent')}${C.reset}`);
    exports.forEach((item, index) => {
      console.log(`  ${C.cyan}${String(index + 1).padStart(2)}${C.reset}  ${path.basename(item.file)}  ${C.dim}${fmtSize(item.size)} · ${fmtTime(item.mtime)}${C.reset}`);
    });
    console.log('');
  } else {
    console.log(`${C.yellow}${t('noExports')}${C.reset}\n`);
  }

  const answer = await ask(t('pickFile'));
  if (answer.toLowerCase() === 's') {
    await settingsMenu();
    return chooseFile();
  }
  if (!answer) {
    if (!exports.length) return null;
    return exports[0].file;
  }
  const index = Number(answer);
  if (Number.isInteger(index) && index >= 1 && index <= exports.length) return exports[index - 1].file;
  return path.resolve(answer.replace(/^["']|["']$/g, ''));
}

/** 选一个分支点：在用户消息里全文匹配，多条时按时间顺序编号选 */
async function chooseBranch(conversation) {
  const messages = conversation.messageList || [];
  const users = messages.map((m, index) => ({ m, index })).filter((item) => item.m.role === 'user');
  if (users.length < 2) return null;

  console.log(`\n${C.bold}${t('branchTitle')}${C.reset}  ${C.dim}${t('branchHint', users.length)}${C.reset}`);
  const keyword = await ask(t('branchPrompt'));
  if (!keyword) return null;

  const needle = keyword.toLowerCase();
  const matches = users.filter((item) => String(item.m.content || '').toLowerCase().includes(needle));
  if (!matches.length) {
    console.log(`${C.yellow}${t('branchNoMatch')}${C.reset}`);
    return null;
  }

  matches.forEach((item, i) => {
    const text = String(item.m.content || '').replace(/\s+/g, ' ').slice(0, 60);
    console.log(`  ${C.cyan}${String(i + 1).padStart(2)}${C.reset}  #${item.index + 1}  ${text}${text.length >= 60 ? '…' : ''}`);
  });

  const pick = await ask(`\n${t('branchPick', matches.length)}`);
  const chosen = Math.min(Math.max(Number(pick || '1') - 1, 0), matches.length - 1);
  const startIndex = matches[chosen].index;
  console.log(`${C.green}${t('branchChosen', startIndex + 1)}${C.reset}`);
  return startIndex;
}

async function chooseConversations(file) {
  const items = peekExport([file]);
  if (!items.length) {
    console.log(`${C.red}${t('noConvs')}${C.reset}`);
    return null;
  }
  console.log(`\n${C.bold}${t('preview')}${C.reset}  ${C.dim}${path.basename(file)}${C.reset}`);

  // 同一个对话在不同导出里可能重复出现：按 id 计数，标出来
  const idCount = new Map();
  for (const item of items) if (item.id) idCount.set(item.id, (idCount.get(item.id) || 0) + 1);

  items.forEach((item, index) => {
    if (item.error) {
      console.log(`  ${C.red}${index + 1}. ${item.error}${C.reset}`);
      return;
    }
    const extras = [item.thinking ? t('thinkingN', item.thinking) : null, item.attachments ? t('attachN', item.attachments) : null]
      .filter(Boolean)
      .join(' · ');
    const dup = item.id && idCount.get(item.id) > 1 ? ` ${C.yellow}${t('dupMark', idCount.get(item.id))}${C.reset}` : '';
    console.log(`  ${C.cyan}${String(index + 1).padStart(2)}${C.reset}  ${item.title}${dup}`);
    console.log(`      ${C.dim}${t('head', item.messages, item.chars)}${extras ? ' · ' + extras : ''}${C.reset}`);
    if (item.firstUser) console.log(`      ${C.dim}${t('firstAsk')}${item.firstUser}${C.reset}`);
    if (item.lastAssistant) console.log(`      ${C.dim}${t('lastAnswer')}${item.lastAssistant}${C.reset}`);
  });

  const answer = await ask(`\n${t('pickConvs')}`);
  const picked = parseSelection(answer, items.length);
  const selected = picked.map((i) => items[i - 1]).filter((item) => item && !item.error);
  if (!selected.length) {
    console.log(`${C.red}${t('nonePicked')}${C.reset}`);
    return null;
  }
  return selected;
}

async function chooseWorkspace() {
  const workspaces = getWorkspaces();
  if (!workspaces.length) {
    console.log(`${C.red}${t('noWs')}${C.reset}`);
    return null;
  }
  console.log(`\n${C.bold}${t('pickWs')}${C.reset}`);
  workspaces.forEach((ws, index) => {
    console.log(`  ${C.cyan}${String(index + 1).padStart(2)}${C.reset}  ${ws.title}  ${C.dim}${ws.path} (${ws.sessionCount})${C.reset}`);
  });
  const answer = await ask(`\n${t('wsIndex')}`);
  const index = Math.min(Math.max(Number(answer || '1') - 1, 0), workspaces.length - 1);
  return workspaces[index];
}

async function main() {
  banner();

  const file = await chooseFile();
  if (!file) return;

  const selected = await chooseConversations(file);
  if (!selected) return;

  // 分支点：只在单条对话时有意义
  let branchIndex = null;
  if (selected.length === 1) {
    branchIndex = await chooseBranch(selected[0]);
  }

  const workspace = await chooseWorkspace();
  if (!workspace) return;

  console.log(`\n${C.bold}${t('aboutImport')}${C.reset}`);
  for (const item of selected) console.log(`  · ${item.title}  ${C.dim}(${item.messages})${C.reset}`);
  console.log(`  ${t('to')}：${workspace.title}  ${C.dim}${workspace.path}${C.reset}`);
  if (branchIndex !== null) console.log(`  ${t('branchChosen', branchIndex + 1)}`);

  const confirm = (await ask(`\n${t('confirm')}`)).toLowerCase();
  if (confirm === 'n' || confirm === 'no') {
    console.log(`${C.yellow}${t('canceled')}${C.reset}`);
    return;
  }

  console.log('');
  await runImport({
    files: [file],
    workspacePath: workspace.path,
    only: selected.map((item) => item.id),
    fromIndex: branchIndex,
  });

  console.log(`\n${C.green}${t('done', workspace.title)}${C.reset}`);
}

main()
  .catch((error) => {
    console.error(`\n${C.red}${error?.stack || error}${C.reset}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
