/**
 * 隔离世界的内容脚本：
 * 1. 接收主世界注入脚本嗅探到的对话，转交后台存储；
 * 2. 提供 DOM 兜底抓取（网络嗅探没命中时用）；
 * 3. 按需把消息里的图片抓成 dataURL（导出时内嵌）。
 */
(function () {
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
  const MAX_FILE_BYTES = 25 * 1024 * 1024;

  function roleOf(raw) {
    const r = String(raw || '').toUpperCase();
    if (r === 'USER' || r === 'HUMAN') return 'user';
    if (r === 'ASSISTANT' || r === 'AI' || r === 'MODEL') return 'assistant';
    return null;
  }

  function guessFileUrl(file) {
    const candidates = [file?.url, file?.file_url, file?.src, file?.download_url, file?.signed_url];
    for (const c of candidates) {
      if (typeof c === 'string' && /^(https?:)?\//.test(c)) {
        return c.startsWith('//') ? `https:${c}` : c;
      }
    }
    return null;
  }

  // 附件大小：不同接口字段名不一样，能拿到就记下来
  function guessFileSize(file) {
    const value = file?.file_size ?? file?.size ?? file?.bytes ?? file?.content_length;
    return typeof value === 'number' && value >= 0 ? value : null;
  }

  function humanSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function normalizeMessage(m) {
    const role = roleOf(m?.role ?? m?.author);
    if (!role) return null;

    // DeepSeek 的真实结构是 fragments 数组：THINK 是思考，其余是回答正文
    let content = typeof m?.content === 'string' ? m.content : '';
    let thinking = typeof m?.thinking_content === 'string' ? m.thinking_content : '';
    if (Array.isArray(m?.fragments) && m.fragments.length) {
      const joined = (type) =>
        m.fragments
          .filter((fragment) => (type === 'THINK' ? fragment?.type === 'THINK' : fragment?.type !== 'THINK'))
          .map((fragment) => fragment?.content || '')
          .join('');
      const fromFragments = joined('RESPONSE').trim();
      const fromThink = joined('THINK').trim();
      if (fromFragments) content = fromFragments;
      if (fromThink) thinking = fromThink;
    }

    // 页面底部那句固定免责声明不属于回答内容
    content = content
      .replace(/\s*本回答由\s*AI\s*生成[，,、\s]*内容仅供参考[，,、\s]*请仔细甄别[。.!！]?\s*$/i, '')
      .replace(/\s*本回答由\s*AI\s*生成[，,、\s]*内容仅供参考[，,、\s]*请仔细甄别[。.!！]?/gi, '')
      .trim();

    // 联网搜索的引用表：正文里是 [reference:N] 标记，真正的标题/链接在这里
    const rawRefs = [];
    if (Array.isArray(m?.references)) rawRefs.push(...m.references);
    if (Array.isArray(m?.fragments)) {
      for (const fragment of m.fragments) {
        if (Array.isArray(fragment?.references)) rawRefs.push(...fragment.references);
      }
    }
    const references = rawRefs
      .map((ref, index) => ({
        index,
        url: ref?.url ?? ref?.link ?? ref?.source_url ?? ref?.href ?? null,
        title: ref?.title ?? ref?.site_name ?? ref?.name ?? ref?.text ?? null,
      }))
      .filter((ref) => typeof ref.url === 'string' && ref.url);

    const files = Array.isArray(m?.files)
      ? m.files
          .map((f) => ({
            name: f?.file_name ?? f?.name ?? f?.filename ?? 'attachment',
            url: guessFileUrl(f),
            mime: f?.content_type ?? f?.mime_type ?? null,
            size: guessFileSize(f),
          }))
          // 搜索结果里的站点图标不是用户附件，过滤掉
          .filter((f) => !/site-icons|favicon|\.svg(\?|$)|\/icon/i.test(f.url || ''))
      : [];
    // 只有思考、正文为空的消息也要保留，否则 thinking.md 会缺段
    if (!content.trim() && files.length === 0 && !thinking.trim()) return null;
    const seconds = m?.inserted_at ?? m?.created_at ?? m?.updated_at;
    return {
      role,
      content,
      thinking,
      files,
      time: typeof seconds === 'number' ? Math.round(seconds * 1000) : null,
      messageId: m?.message_id ?? m?.id ?? null,
      // 编辑/重新生成会产生树结构：同 parent 同角色的多条 = 同一处的多个版本
      parentId: m?.parent_id ?? null,
      // WIP / INTERRUPTED 之类：用来识别「被中止的输出」
      status: typeof m?.status === 'string' ? m.status : null,
      incomplete: Boolean(m?.incomplete_message),
      references,
    };
  }

  function normalizeSession(session, messages) {
    return {
      id: String(session.id),
      title: String(session.title || '未命名对话'),
      createdAt: session.inserted_at ? Math.round(session.inserted_at * 1000) : null,
      updatedAt: session.updated_at ? Math.round(session.updated_at * 1000) : null,
      messages: messages.map(normalizeMessage).filter(Boolean),
    };
  }

  // ---- 1. 主世界 → 后台 ----
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__dshExporter !== true) return;

    // 流式回答：一条刚生成完的 assistant 消息
    if (data.kind === 'stream') {
      if (!data.message) return;
      chrome.runtime.sendMessage({
        type: 'stream',
        sessionId: data.sessionId ?? null,
        message: data.message,
      });
      return;
    }

    if (data.kind !== 'capture') return;
    try {
      const session = normalizeSession(data.session, data.messages);
      if (!session.messages.length) return;
      chrome.runtime.sendMessage({
        type: 'capture',
        session,
        url: data.url,
        origin: /history_messages/.test(String(data.url || '')) ? 'history' : 'api',
      });
    } catch (error) {
      console.warn('[DSH 导出] 归一化失败', error);
    }
  });

  // ---- 2. DOM 兜底 ----
  function domExtract() {
    const markdowns = [...document.querySelectorAll('.ds-markdown')];
    if (markdowns.length === 0) return { messages: [], reason: '页面上没有找到 .ds-markdown 节点' };

    // 找所有 .ds-markdown 的最近公共祖先作为对话容器
    let container = markdowns[0].parentElement;
    for (const node of markdowns.slice(1)) {
      while (container && !container.contains(node)) container = container.parentElement;
    }
    if (!container) return { messages: [], reason: '无法确定对话容器' };

    // 容器下「自成一段」的子节点逐个判断：含 .ds-markdown 的是助手，否则有文本的是用户
    const rows = [...container.children];
    const messages = [];
    const rowElements = [];
    for (const row of rows) {
      const text = (row.innerText || '').trim();
      if (!text) continue;
      const blocks = [...row.querySelectorAll('.ds-markdown')];
      const isAssistant = blocks.length > 0;
      if (!isAssistant && text.length > 2000) continue; // 跳过侧边栏/杂项
      // 思考块与正文块都用 .ds-markdown 渲染：前面的当思考，最后一个当正文
      const parts = blocks.map((block) => markdownToText(block)).filter(Boolean);
      messages.push({
        role: isAssistant ? 'assistant' : 'user',
        content: isAssistant ? (parts.length ? parts[parts.length - 1] : text) : text,
        thinking: isAssistant && parts.length > 1 ? parts.slice(0, -1).join('\n\n') : '',
        files: [...row.querySelectorAll('img')]
          .map((img) => ({ name: 'image', url: img.currentSrc || img.src, mime: null }))
          .filter((f) => f.url),
        time: null,
        messageId: null,
      });
      rowElements.push(row);
    }

    // 首条如果是助手，说明用户的开场白落在了容器外（它没有 .ds-markdown）：
    // 往回找最近的一段纯文本补齐，避免对话缺开头。
    if (messages.length && messages[0].role === 'assistant') {
      let node = rowElements[0]?.previousElementSibling;
      let found = null;
      for (let hop = 0; node && hop < 4; hop += 1, node = node.previousElementSibling) {
        const text = (node.innerText || '').trim();
        if (!text || text.length > 4000) continue;
        if (node.querySelector('.ds-markdown')) break;
        found = { role: 'user', content: text, thinking: '', files: [], time: null, messageId: null };
        break;
      }
      if (found) messages.unshift(found);
    }

    return {
      messages,
      reason: messages.length ? null : '容器里没有可识别的消息',
    };
  }

  // 尽量保留代码块与列表结构
  function markdownToText(root) {
    if (!root) return '';
    const clone = root.cloneNode(true);
    clone.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code');
      const lang = (code?.className || '').match(/language-([\w-]+)/)?.[1] || '';
      const body = code ? code.innerText : pre.innerText;
      pre.replaceWith(document.createTextNode(`\n\`\`\`${lang}\n${body.replace(/\n$/, '')}\n\`\`\`\n`));
    });
    clone.querySelectorAll('table').forEach((table) => {
      const rows = [...table.querySelectorAll('tr')].map((tr) =>
        [...tr.querySelectorAll('th,td')].map((cell) => (cell.innerText || '').trim().replace(/\|/g, '\\|'))
      );
      if (!rows.length) return;
      const header = `| ${rows[0].join(' | ')} |`;
      const divider = `| ${rows[0].map(() => '---').join(' | ')} |`;
      const body = rows.slice(1).map((r) => `| ${r.join(' | ')} |`);
      table.replaceWith(document.createTextNode(`\n${[header, divider, ...body].join('\n')}\n`));
    });
    return (clone.innerText || '').trim();
  }

  // ---- 3. 附件内嵌（图片与普通文件都走这里）----
  async function inlineFiles(requests) {
    const out = [];
    for (const request of requests) {
      const url = typeof request === 'string' ? request : request.url;
      const isImage = typeof request === 'object' && request.kind === 'image';
      const limit = isImage ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          out.push({ url, dataUrl: null, error: `HTTP ${res.status}` });
          continue;
        }
        const blob = await res.blob();
        if (blob.size > limit) {
          out.push({ url, dataUrl: null, error: `超过 ${humanSize(limit)}` });
          continue;
        }
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        out.push({ url, dataUrl, mime: blob.type || null, size: blob.size });
      } catch (error) {
        out.push({ url, dataUrl: null, error: String(error?.message ?? error) });
      }
    }
    return out;
  }

  // ---- 4. 自动回溯：反复滚到顶，让页面把更早的分页加载出来 ----
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findScrollContainer() {
    const marks = document.querySelectorAll('.ds-markdown');
    if (!marks.length) return document.scrollingElement;

    // 从每条消息往上找可滚动祖先，取「可滚动距离最大」的那个：
    // 页面上可能有多个 overflow 容器，猜错就会滚了等于没滚。
    let best = null;
    let bestRange = 0;
    for (const mark of marks) {
      let node = mark.parentElement;
      for (let depth = 0; node && depth < 15; depth += 1, node = node.parentElement) {
        const style = getComputedStyle(node);
        if (!/(auto|scroll)/.test(style.overflowY)) continue;
        const range = node.scrollHeight - node.clientHeight;
        if (range > 100 && range > bestRange) {
          best = node;
          bestRange = range;
        }
      }
    }
    return best || document.scrollingElement;
  }

  // ---- 4.5 本地缓存：deepseek-chat / history-message ----
  // 有些对话的接口直接返回 chat_messages: []，消息只存在 IndexedDB 里。
  function openDb(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function idbGet(db, storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** 在缓存记录里递归找「像消息数组」的那一段 */
  function findMessageArray(value, depth = 0) {
    if (depth > 6 || value === null || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      const looksLikeMessages = value.some(
        (item) => item && typeof item === 'object' && (item.role || item.message_id !== undefined) && (item.content !== undefined || item.fragments)
      );
      if (looksLikeMessages) return value;
      for (const item of value) {
        const hit = findMessageArray(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    for (const key of Object.keys(value)) {
      const hit = findMessageArray(value[key], depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  function describeShape(value, depth = 0) {
    if (depth > 3) return '…';
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (value === null) return 'null';
    if (typeof value !== 'object') return typeof value;
    const keys = Object.keys(value).slice(0, 12);
    return `{${keys.join(',')}}`;
  }

  async function readCachedHistory() {
    const sessionId = sessionIdFromLocation();
    if (!sessionId) return { ok: false, error: '无法从 URL 取得 session id' };

    let db;
    try {
      db = await openDb('deepseek-chat');
    } catch (error) {
      return { ok: false, error: `打开 IndexedDB 失败：${error?.message ?? error}` };
    }

    try {
      if (!db.objectStoreNames.contains('history-message')) {
        return { ok: false, error: '没有 history-message store' };
      }
      const record = await idbGet(db, 'history-message', sessionId);
      if (record === undefined) return { ok: false, error: `缓存里没有 ${sessionId}` };

      const raw = findMessageArray(record);
      const shape = describeShape(record);
      if (!raw) {
        return { ok: false, error: '找到了记录但没解析出消息数组', shape, sample: JSON.stringify(record).slice(0, 800) };
      }

      const dropped = [];
      const messages = raw
        .map((item) => {
          try {
            const normalized = normalizeMessage(item);
            if (!normalized) {
              dropped.push({
                role: item?.role ?? null,
                keys: Object.keys(item || {}).slice(0, 8),
                contentLen: String(item?.content ?? '').length,
              });
            }
            return normalized;
          } catch (error) {
            dropped.push({ role: item?.role ?? null, error: String(error?.message ?? error) });
            return null;
          }
        })
        .filter(Boolean);

      // 引用表到底在不在缓存记录里？把 data 的顶层键带出来
      const dataKeys =
        record && record.data && typeof record.data === 'object' && !Array.isArray(record.data)
          ? Object.keys(record.data).slice(0, 20)
          : Object.keys(record || {}).slice(0, 20);

      return {
        ok: true,
        count: messages.length,
        rawCount: raw.length,
        messages,
        shape,
        dataKeys,
        dropped: dropped.slice(0, 10),
        droppedCount: dropped.length,
        sample: JSON.stringify(raw[0] || {}).slice(0, 600),
      };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    } finally {
      db?.close?.();
    }
  }

  function sessionIdFromLocation() {
    const match = /\/chat\/s\/([0-9a-f-]{8,})/i.exec(location.pathname || '');
    return match ? match[1] : null;
  }

  /** 回溯过程中每有进展就入库：popup 被关掉也不会白跑 */
  function pushCapture(messages) {
    const id = sessionIdFromLocation() || `dom-${(location.pathname.split('/').pop() || 'page').slice(0, 32)}`;
    chrome.runtime.sendMessage({
      type: 'capture',
      origin: 'dom-scroll',
      url: location.href,
      session: {
        id,
        title: document.title.replace(/\s*-\s*DeepSeek.*$/i, '') || 'page',
        createdAt: null,
        updatedAt: Date.now(),
        messages,
      },
    });
  }

  async function autoBackfill({ rounds = 160, delay = 420, stepRatio = 0.9 } = {}) {
    // 本地缓存优先：接口返回 chat_messages: [] 的对话，全量只在 IndexedDB 里
    let cacheError = null;
    try {
      const cached = await readCachedHistory();
      if (cached.ok && cached.messages?.length) {
        pushCapture(cached.messages);
        return {
          ok: true,
          source: 'cache',
          messages: cached.messages,
          rounds: 0,
          captures: 1,
          delta: 0,
          shape: cached.shape,
        };
      }
      cacheError = `${cached.error || '缓存为空'}${cached.shape ? ` | 结构 ${cached.shape}` : ''}`;
    } catch (error) {
      cacheError = String(error?.message ?? error);
    }

    const container = findScrollContainer();
    if (!container) return { ok: false, error: '找不到可滚动的对话容器' };

    // 先落到底部，确保从「最新」这一端开始往上推
    container.scrollTop = container.scrollHeight;
    await sleep(delay);
    const startHeight = container.scrollHeight;

    let lastHeight = container.scrollHeight;
    let lastCount = 0;
    let stagnant = 0;
    let done = 0;
    let captures = 0;

    for (let round = 0; round < rounds; round += 1) {
      done = round + 1;
      const beforeHeight = container.scrollHeight;

      // 一次一屏地往上推：直接跳到 0 只会触发一次加载
      const step = Math.max(200, Math.floor(container.clientHeight * stepRatio));
      container.scrollTop = Math.max(0, container.scrollTop - step);
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
      container.dispatchEvent(new WheelEvent('wheel', { deltaY: -step, bubbles: true }));
      await sleep(delay);

      const afterHeight = container.scrollHeight;
      let messages = [];
      try {
        messages = domExtract().messages || [];
      } catch {
        messages = [];
      }

      // 进度信号用「滚动高度」：更早的消息是往上插的，高度会变长
      const grew = afterHeight > beforeHeight + 20 || messages.length > lastCount;
      if (grew) {
        lastHeight = afterHeight;
        lastCount = messages.length;
        stagnant = 0;
        try {
          pushCapture(messages);
          captures += 1;
        } catch {
          /* 入库失败不影响继续回溯 */
        }
      } else {
        stagnant += 1;
      }

      if (stagnant >= 5) break; // 连续几轮都没有新内容，认为到头了
    }

    let messages = [];
    try {
      messages = domExtract().messages || [];
    } catch {
      messages = [];
    }

    return {
      ok: true,
      source: 'dom',
      messages,
      rounds: done,
      captures,
      height: container.scrollHeight,
      delta: container.scrollHeight - startHeight,
      cacheError,
    };
  }

  // ---- 5. 客户端缓存探查 ----
  // 有些对话的 /chat/history_messages 返回空数组，消息实际存在浏览器本地
  // （cache_control: MERGE 就是线索）。这里只读结构，不导出正文。
  async function probeCaches() {
    const summary = { databases: [], storage: [] };

    try {
      const dbs = (await indexedDB.databases?.()) || [];
      for (const info of dbs.slice(0, 20)) {
        if (!info.name) continue;
        const entry = { name: info.name, version: info.version, stores: [] };
        try {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(info.name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          for (const storeName of [...db.objectStoreNames].slice(0, 20)) {
            try {
              const tx = db.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const count = await new Promise((resolve) => {
                const request = store.count();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(-1);
              });
              const sampleKey = await new Promise((resolve) => {
                const request = store.getAllKeys();
                request.onsuccess = () => resolve(request.result?.slice(0, 5));
                request.onerror = () => resolve(null);
              });
              entry.stores.push({ name: storeName, count, sampleKey });
            } catch (error) {
              entry.stores.push({ name: storeName, error: String(error?.message ?? error) });
            }
          }
          db.close();
          summary.databases.push(entry);
        } catch (error) {
          summary.databases.push({ ...entry, error: String(error?.message ?? error) });
        }
      }
    } catch (error) {
      summary.indexedDbError = String(error?.message ?? error);
    }

    try {
      const sessionId = sessionIdFromLocation();
      for (const [key, value] of Object.entries(localStorage)) {
        const text = String(value || '');
        summary.storage.push({
          key,
          size: text.length,
          mentionsSession: sessionId ? text.includes(sessionId) : false,
          head: text.slice(0, 120),
        });
      }
      summary.storage = summary.storage.slice(0, 60);
    } catch (error) {
      summary.storageError = String(error?.message ?? error);
    }

    return summary;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'scan-dom') {
      try {
        const result = domExtract();
        sendResponse({
          ok: true,
          ...result,
          title: document.title.replace(/\s*-\s*DeepSeek.*$/i, '') || '当前页面',
          url: location.href,
        });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message ?? error) });
      }
      return true;
    }
    if (message?.type === 'auto-backfill') {
      autoBackfill(message.options || {})
        .then((result) =>
          sendResponse({
            ...result,
            title: document.title.replace(/\s*-\s*DeepSeek.*$/i, '') || '当前页面',
            url: location.href,
          })
        )
        .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
      return true;
    }
    if (message?.type === 'dump-calls') {
      let answered = false;
      const handler = (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.__dshExporter !== true || data.kind !== 'calls') return;
        if (answered) return;
        answered = true;
        window.removeEventListener('message', handler);
        sendResponse({ ok: true, calls: data.calls || [], samples: data.samples || [] });
      };
      window.addEventListener('message', handler);
      window.postMessage({ __dshExporter: true, kind: 'dump-calls' }, 'https://chat.deepseek.com');
      setTimeout(() => {
        if (answered) return;
        answered = true;
        window.removeEventListener('message', handler);
        sendResponse({ ok: false, error: '页面注入脚本没有响应（扩展刚更新的话，先刷新页面）' });
      }, 1500);
      return true;
    }
    if (message?.type === 'cache-shape') {
      readCachedHistory()
        .then((result) => {
          const { messages, ...rest } = result;
          sendResponse({ ...rest, messageCount: messages?.length ?? 0 });
        })
        .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
      return true;
    }
    if (message?.type === 'probe-caches') {
      probeCaches()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
      return true;
    }
    if (message?.type === 'inline-files' || message?.type === 'inline-images') {
      const requests = message.requests || message.urls || [];
      inlineFiles(requests).then((files) => sendResponse({ ok: true, images: files, files }));
      return true;
    }
    return false;
  });
})();
