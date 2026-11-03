const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const statusEl = document.getElementById('status');
let captures = [];

// ---------------------------------------------------------------- i18n

const STRINGS = {
  zh: {
    title: 'DSH 对话迁移',
    hint: '在 DeepSeek 里打开任意对话，加载完成后它会自动出现在下面。',
    selectAll: '全选',
    selectNone: '反选',
    capture: '抓取对话',
    captureWorking: '正在抓取…（优先读本地缓存，其次自动回溯）',
    backfillDone: (n, r, c, d, ce) => `回溯完成：当前屏 ${n} 条，${r} 轮，入库 ${c} 次，高度 +${d}px${ce ? '（缓存不可用：' + ce + '）' : ''}`,
    backfillCache: (n) => `已从浏览器本地缓存读取 ${n} 条消息（无需滚动）`,
    backfillFailed: (e) => `回溯失败：${e}`,
    refresh: '刷新',
    debug: '诊断',
    clearAll: '清空',
    langLabel: '语言',
    subdirLabel: '保存子目录',
    subdirHint: '留空 = 直接存到浏览器下载目录。填子目录时，导入脚本也会扫这个子目录。',
    autoTrimLabel: '超长对话自动截断',
    autoTrimAdvanced: '高级参数',
    autoTrimCharsLabel: '触发阈值（字）',
    autoTrimTurnsLabel: '最多保留轮数',
    autoTrimBudgetLabel: '保留字符预算',
    autoTrimHint: '导入时生效：超过阈值只保留最后若干轮，完整原文另存 transcript.md。',
    sidecarExternalLabel: '旁挂文件写到 DSH 目录',
    sidecarExternalHint: '勾选后不往工作区里写 .dsh-imported，改为 ~/.dsh/import-archive/。',
    save: '保存',
    empty: '还没有捕获到对话。',
    withFiles: '内嵌附件（图片/文件，体积会变大）',
    withThinking: '保留思考过程',
    export: '导出选中',
    delete: '删除选中',
    footerHint: '导出后运行工作区的 dsh-import.cmd，即可重建为 DSH 会话。',
    settingsSaved: (dir) => `已保存（子目录：${dir || '无'}）`,
    refreshed: (n) => `已刷新 · ${n} 个对话`,
    refreshFailed: (e) => `刷新失败：${e}`,
    pageReloaded: '已刷新页面（等同 F5），加载完回来看「来源」是否变成 history',
    notDeepSeek: '当前标签页不是 DeepSeek',
    selecting: '正在整理…',
    pickFirst: '先勾选要导出的对话',
    exported: (n, kb) => `已导出 ${n} 个对话，${kb} KB`,
    cleared: '已清空捕获',
    clearConfirm: '清空所有已捕获的对话？（不影响 DeepSeek 和已导入的 DSH 会话）',
    deleted: (n) => `已删除 ${n} 个捕获`,
    pickToDelete: '先勾选要删除的对话',
    collecting: '正在收集诊断信息…',
    debugExported: (c, s, kb) => `已导出诊断：${c} 条请求，${s} 段流样本（${kb} KB）`,
    debugNoTab: '先在 Edge 打开 DeepSeek 页面再点诊断',
    scanning: '正在读取当前页面…',
    scanNoTab: '请先在 Edge 打开 chat.deepseek.com 的对话',
    scanNotReady: '页面脚本未就绪，刷新一次页面再试',
    scanNoMessages: '没有识别到消息，打开对话让它先加载完',
    scanOk: (n) => `从页面抓取到 ${n} 条消息（实验性）`,
    domFallback: '这条来自页面兜底，先打开原对话再抓',
    refetchOpened: '已在新标签页打开，等它加载完后回到这里看「来源」是否变成 history',
    attachFailed: '附件下载失败：后台与页面都没取到',
    meta: (msgs, chars, thinking, attach, origins, time) =>
      `${msgs} 条 · ${chars} 字 · 思考 ${thinking} 段${attach} · 来源 ${origins} · ${time}`,
    attach: (a, b) => ` · 附件 ${a}/${b} 内嵌`,
  },
  en: {
    title: 'DSH Chat Migrator',
    hint: 'Open any conversation on DeepSeek; once loaded it shows up below.',
    selectAll: 'All',
    selectNone: 'Invert',
    capture: 'Capture chat',
    captureWorking: 'Capturing… (local cache first, then auto-backfill)',
    backfillDone: (n, r, c, d, ce) => `Backfill done: ${n} on screen, ${r} rounds, ${c} captures, height +${d}px${ce ? ` (cache unavailable: ${ce})` : ''}`,
    backfillCache: (n) => `Read ${n} messages from the browser's local cache (no scrolling needed)`,
    backfillFailed: (e) => `Backfill failed: ${e}`,
    refresh: 'Reload',
    debug: 'Diagnose',
    clearAll: 'Clear',
    langLabel: 'Language',
    subdirLabel: 'Save subfolder',
    subdirHint: 'Empty = browser download folder. The importer scans this subfolder too.',
    autoTrimLabel: 'Auto-trim very long chats',
    autoTrimAdvanced: 'Advanced',
    autoTrimCharsLabel: 'Trigger threshold (chars)',
    autoTrimTurnsLabel: 'Max turns kept',
    autoTrimBudgetLabel: 'Kept char budget',
    autoTrimHint: 'Applied on import: over the threshold only the last turns are kept; the full text goes to transcript.md.',
    sidecarExternalLabel: 'Write sidecars to DSH home',
    sidecarExternalHint: 'Keeps .dsh-imported out of the workspace; files go to ~/.dsh/import-archive/.',
    save: 'Save',
    empty: 'No conversations captured yet.',
    withFiles: 'Embed attachments (images/files, larger file)',
    withThinking: 'Keep thinking',
    export: 'Export selected',
    delete: 'Delete selected',
    footerHint: 'Run dsh-import.cmd in the workspace afterwards to rebuild DSH sessions.',
    settingsSaved: (dir) => `Saved (subfolder: ${dir || 'none'})`,
    refreshed: (n) => `Refreshed · ${n} conversations`,
    refreshFailed: (e) => `Refresh failed: ${e}`,
    pageReloaded: 'Page reloaded (same as F5); check whether 来源 turns into history',
    notDeepSeek: 'Active tab is not DeepSeek',
    selecting: 'Preparing…',
    pickFirst: 'Select at least one conversation',
    exported: (n, kb) => `Exported ${n} conversations, ${kb} KB`,
    cleared: 'Captures cleared',
    clearConfirm: 'Clear all captures? (DeepSeek and imported DSH sessions are untouched)',
    deleted: (n) => `Deleted ${n} captures`,
    pickToDelete: 'Select captures to delete first',
    collecting: 'Collecting diagnostics…',
    debugExported: (c, s, kb) => `Diagnostics exported: ${c} requests, ${s} stream samples (${kb} KB)`,
    debugNoTab: 'Open a DeepSeek page before diagnosing',
    scanning: 'Reading current page…',
    scanNoTab: 'Open a chat.deepseek.com conversation first',
    scanNotReady: 'Content script not ready, refresh the page and retry',
    scanNoMessages: 'No messages found; let the conversation finish loading',
    scanOk: (n) => `Captured ${n} messages from the page (experimental)`,
    domFallback: 'This capture came from the DOM fallback; open the conversation and retry',
    refetchOpened: 'Opened in a new tab; check whether 来源 becomes history',
    attachFailed: 'Attachment download failed (background and page)',
    meta: (msgs, chars, thinking, attach, origins, time) =>
      `${msgs} msgs · ${chars} chars · ${thinking} thinking${attach} · from ${origins} · ${time}`,
    attach: (a, b) => ` · ${a}/${b} attachments`,
  },
};

let lang = 'zh';
let settings = {
  lang: 'zh',
  subdir: 'dsh-import',
  autoTrim: true,
  autoTrimChars: 120000,
  autoTrimTurns: 20,
  autoTrimBudget: 60000,
  sidecarExternal: false,
};

// 语言的唯一真源放在 <html lang> 上：任何代码路径读到的都是同一个值，
// 避免出现「按钮是英文、状态栏是中文」这种不同步。
function currentLang() {
  return document.documentElement.lang === 'en' ? 'en' : 'zh';
}

function t(key, ...args) {
  const table = STRINGS[currentLang()] || STRINGS.zh;
  const value = table[key] ?? STRINGS.zh[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

function applyLang() {
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  // 说明文字挂在问号的 title 上，不占版面
  for (const el of document.querySelectorAll('[data-help]')) {
    const text = t(el.dataset.help);
    el.title = text;
    el.setAttribute('aria-label', text);
  }
  document.getElementById('lang').value = lang;
  document.getElementById('subdir').value = settings.subdir || '';
  document.getElementById('autoTrim').checked = settings.autoTrim !== false;
  document.getElementById('autoTrimChars').value = settings.autoTrimChars || 120000;
  document.getElementById('autoTrimTurns').value = settings.autoTrimTurns || 20;
  document.getElementById('autoTrimBudget').value = settings.autoTrimBudget || 60000;
  document.getElementById('sidecarExternal').checked = settings.sidecarExternal === true;
}

async function loadSettings() {
  const data = await chrome.storage.local.get('settings');
  settings = {
    lang: 'zh',
    subdir: 'dsh-import',
    autoTrim: true,
    autoTrimChars: 120000,
    autoTrimTurns: 20,
    autoTrimBudget: 60000,
    sidecarExternal: false,
    ...(data.settings || {}),
  };
  lang = settings.lang === 'en' ? 'en' : 'zh';
  applyLang();
}

// ---------------------------------------------------------------- 基础

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (res) => resolve(res)));
}

function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

let lastSignature = null;

async function load(showStatus = false) {
  try {
    const res = await send({ type: 'list' });
    const next = (res?.captures || []).filter((c) => Array.isArray(c.messages) && c.messages.length > 0);
    const signature = next
      .map((c) => `${c.id}:${c.messages.length}:${c.messages.reduce((sum, m) => sum + (m.content || '').length + (m.thinking || '').length, 0)}`)
      .join('|');
    const changed = signature !== lastSignature;
    captures = next;
    if (changed || showStatus) {
      lastSignature = signature;
      render();
    }
    if (showStatus) setStatus(t('refreshed', captures.length));
  } catch (error) {
    setStatus(t('refreshFailed', error?.message ?? error));
  }
}

function render() {
  const previouslyChecked = new Set(selectedIds());
  const keepSelection = previouslyChecked.size > 0;
  listEl.innerHTML = '';
  emptyEl.style.display = captures.length ? 'none' : 'block';
  for (const c of captures) {
    const msgs = Array.isArray(c.messages) ? c.messages : [];
    const li = document.createElement('li');
    li.innerHTML = `
      <input type="checkbox" data-id="${c.id}" />
      <div class="body">
        <div class="title"></div>
        <div class="meta"></div>
      </div>
      <button class="ghost refetch" title="refetch">↻</button>`;
    const checkbox = li.querySelector('input[type=checkbox]');
    checkbox.checked = keepSelection ? previouslyChecked.has(c.id) : true;
    li.querySelector('.refetch').addEventListener('click', async () => {
      if (!/^[0-9a-f-]{8,}$/i.test(c.id)) return setStatus(t('domFallback'));
      await chrome.tabs.create({ url: `https://chat.deepseek.com/a/chat/s/${c.id}` });
      setStatus(t('refetchOpened'));
    });
    li.querySelector('.title').textContent = c.title || '—';

    const thinkingCount = msgs.filter((m) => m.thinking && m.thinking.trim()).length;
    const chars = msgs.reduce((sum, m) => sum + (m.content || '').length, 0);
    const origins = (c.origins || []).join('+') || '?';
    const files = msgs.flatMap((m) => m.files || []);
    const embedded = files.filter((f) => f.dataUrl).length;
    const attach = files.length ? t('attach', embedded, files.length) : '';
    li.querySelector('.meta').textContent = t('meta', msgs.length, chars, thinkingCount, attach, origins, fmtTime(c.updatedAt || c.capturedAt));
    listEl.appendChild(li);
  }
}

function selectedIds() {
  return [...listEl.querySelectorAll('input[type=checkbox]:checked')].map((el) => el.dataset.id);
}

async function inlineFilesFor(sessions) {
  const requests = new Map();
  for (const s of sessions) {
    for (const m of s.messages) {
      for (const f of m.files || []) {
        if (!f.url || f.url.startsWith('data:') || f.dataUrl) continue;
        const kind = /^image\//.test(f.mime || '') || /\.(png|jpe?g|webp|gif)$/i.test(f.name || '') ? 'image' : 'file';
        requests.set(f.url, { url: f.url, kind });
      }
    }
  }
  if (requests.size === 0) return new Map();

  const map = new Map();
  try {
    const viaBackground = await send({ type: 'fetch-files', requests: [...requests.values()] });
    for (const item of viaBackground?.files || []) if (item.dataUrl) map.set(item.url, item);
  } catch {
    /* 后台失败就退回页面内抓 */
  }
  if (map.size > 0) return map;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/chat\.deepseek\.com/.test(tab.url || '')) {
    setStatus(t('attachFailed'));
    return map;
  }
  const res = await chrome.tabs.sendMessage(tab.id, { type: 'inline-files', requests: [...requests.values()] });
  for (const item of res?.files || res?.images || []) if (item.dataUrl) map.set(item.url, item);
  return map;
}

async function downloadJson(payload, prefix, subdir) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const folder = subdir ? `${subdir.replace(/[\\/]+$/, '')}/` : '';
  await chrome.downloads.download({ url, filename: `${folder}${prefix}-${stamp}.json`, saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return json.length;
}

async function dumpDebug() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/chat\.deepseek\.com/.test(tab.url || '')) return setStatus(t('debugNoTab'));
  setStatus(t('collecting'));
  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'dump-calls' });
  } catch (error) {
    res = { ok: false, error: String(error?.message ?? error) };
  }

  // 历史接口返回空数组时，消息其实在浏览器本地缓存里：顺带探一下结构
  let caches = null;
  try {
    const probed = await chrome.tabs.sendMessage(tab.id, { type: 'probe-caches' });
    if (probed?.ok) caches = probed;
  } catch {
    /* 探查失败不影响其它诊断信息 */
  }

  let cacheShape = null;
  try {
    cacheShape = await chrome.tabs.sendMessage(tab.id, { type: 'cache-shape' });
  } catch {
    /* ignore */
  }

  const payload = {
    format: 'dsh-debug',
    exportedAt: new Date().toISOString(),
    page: tab.url,
    error: res?.error ?? null,
    calls: res?.calls ?? [],
    samples: res?.samples ?? [],
    caches,
    cacheShape,
    captures: captures.map((c) => ({
      id: c.id,
      title: c.title,
      messages: c.messages?.length ?? 0,
      sourceUrl: c.sourceUrl ?? null,
      origins: c.origins ?? [],
      lengths: (c.messages || []).map((m) => ({ role: m.role, content: (m.content || '').length, thinking: (m.thinking || '').length })),
    })),
  };
  const size = await downloadJson(payload, 'dsh-debug', '');
  setStatus(t('debugExported', payload.calls.length, payload.samples.length, (size / 1024).toFixed(0)));
}

async function exportSelected() {
  const ids = selectedIds();
  if (ids.length === 0) return setStatus(t('pickFirst'));

  const withFiles = document.getElementById('withImages').checked;
  const withThinking = document.getElementById('withThinking').checked;
  const sessions = captures.filter((c) => ids.includes(c.id)).map((c) => structuredClone(c));

  setStatus(t('selecting'));
  const fileMap = withFiles ? await inlineFilesFor(sessions) : new Map();

  for (const session of sessions) {
    for (const message of session.messages) {
      if (!withThinking) message.thinking = '';
      message.files = (message.files || []).map((f) => {
        const hit = f.url ? fileMap.get(f.url) : null;
        if (!hit) return f;
        return { ...f, dataUrl: hit.dataUrl, mime: f.mime || hit.mime || null, size: f.size ?? hit.size ?? null, url: null };
      });
    }
  }

  const payload = {
    format: 'dsh-deepseek-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    source: 'edge-extension',
    // 导入脚本会读这些默认值；命令行参数优先
    options: {
      autoTrim: settings.autoTrim !== false,
      autoTrimChars: Number(settings.autoTrimChars) || 120000,
      autoTrimTurns: Number(settings.autoTrimTurns) || 20,
      autoTrimBudget: Number(settings.autoTrimBudget) || 60000,
      sidecarExternal: settings.sidecarExternal === true,
    },
    conversations: sessions.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messages: c.messages,
    })),
  };

  const size = await downloadJson(payload, 'dsh-deepseek', settings.subdir);
  setStatus(t('exported', sessions.length, (size / 1024).toFixed(0)));
}

async function captureCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/chat\.deepseek\.com/.test(tab.url || '')) return setStatus(t('scanNoTab'));
  setStatus(t('captureWorking'));

  let res;
  try {
    // 一次调用内部按「本地缓存 → 逐屏回溯」的顺序来
    res = await chrome.tabs.sendMessage(tab.id, { type: 'auto-backfill', options: { rounds: 160, delay: 420 } });
  } catch (error) {
    return setStatus(t('backfillFailed', error?.message ?? error));
  }

  // 什么都拿不到时退回「只抓当前屏」
  if (!res?.ok || !res.messages?.length) {
    return scanCurrentPage();
  }

  const sessionId = ((tab.url || '').match(/\/chat\/s\/([0-9a-f-]{8,})/i) || [])[1];
  const id = sessionId || `dom-${(tab.url.split('/').pop() || 'page').slice(0, 32)}`;
  await send({
    type: 'capture',
    origin: 'dom',
    url: tab.url,
    session: { id, title: res.title || 'page', createdAt: null, updatedAt: Date.now(), messages: res.messages },
  });

  await load();
  setStatus(
    res.source === 'cache'
      ? t('backfillCache', res.messages.length)
      : t('backfillDone', res.messages.length, res.rounds || 0, res.captures || 0, res.delta || 0, res.cacheError || '')
  );
}

async function scanCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/chat\.deepseek\.com/.test(tab.url || '')) return setStatus(t('scanNoTab'));
  setStatus(t('scanning'));
  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'scan-dom' });
  } catch {
    return setStatus(t('scanNotReady'));
  }
  if (!res?.ok || !res.messages?.length) return setStatus(res?.reason || t('scanNoMessages'));

  const sessionId = ((tab.url || '').match(/\/chat\/s\/([0-9a-f-]{8,})/i) || [])[1];
  const id = sessionId || `dom-${(tab.url.split('/').pop() || 'page').slice(0, 32)}`;
  await send({
    type: 'capture',
    origin: 'dom',
    url: tab.url,
    session: { id, title: res.title || 'page', createdAt: null, updatedAt: Date.now(), messages: res.messages },
  });
  await load();
  setStatus(t('scanOk', res.messages.length));
}

// ---------------------------------------------------------------- 事件

document.getElementById('refresh').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && /chat\.deepseek\.com/.test(tab.url || '')) {
    await chrome.tabs.reload(tab.id);
    setStatus(t('pageReloaded'));
  } else {
    setStatus(t('notDeepSeek'));
  }
  await load(true);
});

document.getElementById('selectAll').addEventListener('click', () => {
  listEl.querySelectorAll('input[type=checkbox]').forEach((el) => (el.checked = true));
});
document.getElementById('selectNone').addEventListener('click', () => {
  listEl.querySelectorAll('input[type=checkbox]').forEach((el) => (el.checked = !el.checked));
});
document.getElementById('capture').addEventListener('click', () => captureCurrentPage().catch((e) => setStatus(String(e))));
document.getElementById('debug').addEventListener('click', () => dumpDebug().catch((e) => setStatus(String(e))));
document.getElementById('export').addEventListener('click', () => exportSelected().catch((e) => setStatus(String(e))));
document.getElementById('delete').addEventListener('click', async () => {
  const ids = selectedIds();
  if (!ids.length) return setStatus(t('pickToDelete'));
  await send({ type: 'delete', ids });
  await load();
  setStatus(t('deleted', ids.length));
});
document.getElementById('clearAll').addEventListener('click', async () => {
  if (!confirm(t('clearConfirm'))) return;
  await send({ type: 'clear' });
  lastSignature = null;
  await load();
  setStatus(t('cleared'));
});

document.getElementById('gear').addEventListener('click', () => {
  document.getElementById('settings').classList.toggle('hidden');
});

document.getElementById('lang').addEventListener('change', async (event) => {
  lang = event.target.value === 'en' ? 'en' : 'zh';
  settings = { ...settings, lang };
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  await chrome.storage.local.set({ settings });
  applyLang();
  setStatus('');
});

document.getElementById('saveSettings').addEventListener('click', async () => {
  settings = {
    lang: document.getElementById('lang').value === 'en' ? 'en' : 'zh',
    subdir: document.getElementById('subdir').value.trim().replace(/^[\\/]+|[\\/]+$/g, ''),
    autoTrim: document.getElementById('autoTrim').checked,
    autoTrimChars: Number(document.getElementById('autoTrimChars').value) || 120000,
    autoTrimTurns: Number(document.getElementById('autoTrimTurns').value) || 20,
    autoTrimBudget: Number(document.getElementById('autoTrimBudget').value) || 60000,
    sidecarExternal: document.getElementById('sidecarExternal').checked,
  };
  await chrome.storage.local.set({ settings });
  lang = settings.lang;
  applyLang();
  setStatus(t('settingsSaved', settings.subdir));
});

loadSettings().then(() => load());
setInterval(() => load(false), 2000);
