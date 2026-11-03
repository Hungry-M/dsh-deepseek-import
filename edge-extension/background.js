/**
 * 后台 service worker：把抓到的对话存进 chrome.storage.local，供 popup 读取。
 * 存储结构：{ captures: { [sessionId]: { id, title, createdAt, updatedAt, messages, capturedAt } } }
 */

importScripts('merge.js');

const KEY = 'captures';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 在后台抓附件：扩展的 host_permissions 绕开页面 CORS，
 * content script 里 fetch 跨域附件常常直接被拒。
 */
async function fetchFiles(requests) {
  const out = [];
  for (const request of requests) {
    const url = typeof request === 'string' ? request : request.url;
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        out.push({ url, dataUrl: null, error: `HTTP ${res.status}` });
        continue;
      }
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > MAX_FILE_BYTES) {
        out.push({ url, dataUrl: null, error: '文件过大' });
        continue;
      }
      const mime = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
      out.push({
        url,
        dataUrl: `data:${mime};base64,${arrayBufferToBase64(buffer)}`,
        mime,
        size: buffer.byteLength,
      });
    } catch (error) {
      out.push({ url, dataUrl: null, error: String(error?.message ?? error) });
    }
  }
  return out;
}

async function readAll() {
  const data = await chrome.storage.local.get(KEY);
  return data[KEY] || {};
}

async function writeAll(captures) {
  await chrome.storage.local.set({ [KEY]: captures });
}

async function updateBadge() {
  const captures = await readAll();
  const count = Object.keys(captures).length;
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#4D6BFE' });
}

// 抓到对话后立刻把附件下载并内嵌：此刻页面刚请求过这些文件，鉴权一定有效。
// 导出时就不必再赌一次跨域请求。
const enriching = new Set();

async function enrichAttachments(captureId) {
  if (enriching.has(captureId)) return;
  enriching.add(captureId);
  try {
    const captures = await readAll();
    const capture = captures[captureId];
    if (!capture) return;

    const pending = [];
    for (const message of capture.messages || []) {
      for (const file of message.files || []) {
        if (file.url && !file.dataUrl && !file.fetchTried) pending.push(file);
      }
    }
    if (!pending.length) return;

    const results = await fetchFiles(pending.map((file) => ({ url: file.url })));
    const byUrl = new Map(results.map((item) => [item.url, item]));
    for (const file of pending) {
      const hit = byUrl.get(file.url);
      file.fetchTried = true;
      if (hit?.dataUrl) {
        file.dataUrl = hit.dataUrl;
        file.mime = file.mime || hit.mime || null;
        file.size = file.size ?? hit.size ?? null;
      }
    }

    const fresh = await readAll();
    if (fresh[captureId]) {
      fresh[captureId].messages = capture.messages;
      await writeAll(fresh);
    }
  } catch {
    /* 附件失败不影响对话本身 */
  } finally {
    enriching.delete(captureId);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === 'capture') {
        const captures = await readAll();
        const session = message.session;
        const previous = captures[session.id];
        // 分页加载：每次拿到的是某个「窗口」，按身份合并，绝不整段覆盖
        const merged = previous ? DshMerge.mergeMessages(previous.messages, session.messages) : session.messages;
        captures[session.id] = {
          ...session,
          messages: merged,
          capturedAt: Date.now(),
          sourceUrl: message.url || previous?.sourceUrl || null,
          origins: [...new Set([...(previous?.origins || []), message.origin || 'api'])],
        };
        await writeAll(captures);
        await updateBadge();
        sendResponse({ ok: true, count: Object.keys(captures).length });
        enrichAttachments(session.id);
        return;
      }
      if (message?.type === 'fetch-files') {
        const files = await fetchFiles(message.requests || []);
        sendResponse({ ok: true, files });
        return;
      }
      if (message?.type === 'stream') {
        const captures = await readAll();
        const id = message.sessionId || 'live-capture';
        const incoming = message.message;
        const existing = captures[id];
        if (!existing) {
          captures[id] = {
            id,
            title: '实时捕获',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            capturedAt: Date.now(),
            messages: [incoming],
            sourceUrl: null,
            origins: ['stream'],
          };
        } else {
          const last = existing.messages[existing.messages.length - 1];
          const incomingLength = (incoming.content || '').length;
          if (last && last.role === 'assistant' && incomingLength >= (last.content || '').length) {
            // 覆盖历史接口返回的截断版本
            existing.messages[existing.messages.length - 1] = incoming;
          } else {
            existing.messages.push(incoming);
          }
          existing.updatedAt = Date.now();
        }
        await writeAll(captures);
        await updateBadge();
        sendResponse({ ok: true });
        enrichAttachments(id);
        return;
      }
      if (message?.type === 'list') {
        const captures = await readAll();
        sendResponse({
          ok: true,
          captures: Object.values(captures).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
        });
        return;
      }
      if (message?.type === 'delete') {
        const captures = await readAll();
        for (const id of message.ids || []) delete captures[id];
        await writeAll(captures);
        await updateBadge();
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === 'clear') {
        await writeAll({});
        await updateBadge();
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: `未知消息类型 ${message?.type}` });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message ?? error) });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
