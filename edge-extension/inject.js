/**
 * 运行在页面主世界（world: MAIN），在 DeepSeek 自己的 fetch/XHR 外面挂一层。
 * 只读取响应体，不修改请求与响应，不发送任何网络请求。
 */
(() => {
  if (window.__dshExporterHooked) return;
  window.__dshExporterHooked = true;

  const MAX_BYTES = 8 * 1024 * 1024;

  function looksLikeHistory(obj) {
    const biz = obj?.data?.biz_data ?? obj?.biz_data ?? obj?.data ?? obj;
    const messages = biz?.chat_messages;
    const session = biz?.chat_session;
    if (!Array.isArray(messages) || messages.length === 0) return null;
    if (!session || typeof session.id !== 'string') return null;
    return { session, messages };
  }

  // 非 JSON（SSE / 分块文本）留样本，供调试导出定位真实格式
  const samples = [];
  function keepSample(url, text) {
    // 历史响应体较大，留够看清结构
    const limit = /history_messages/.test(String(url)) ? 6000 : 1200;
    samples.push({ url: String(url), type: 'stream', head: text.slice(0, limit), at: Date.now() });
    if (samples.length > 8) samples.shift();
  }

  function handleText(url, text) {
    if (!text) return;
    const trimmed = text.trimStart();
    const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
    if (!looksJson) {
      if (/data:|"delta"|"content"|"v"\s*:/.test(text)) keepSample(url, text);
      return;
    }
    if (text.length > MAX_BYTES) return;
    if (text.indexOf('chat_messages') === -1 && text.indexOf('chat_session') === -1) return;
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      keepSample(url, text);
      return;
    }
    const hit = looksLikeHistory(json);
    // 历史接口的结构决定「老对话」能否完整：无论解析成功与否都留样本
    if (/history_messages|chat_session\/fetch_page/.test(String(url))) keepSample(url, text);
    if (!hit) return;
    window.postMessage(
      {
        __dshExporter: true,
        kind: 'capture',
        session: hit.session,
        messages: hit.messages,
        url: String(url),
      },
      'https://chat.deepseek.com'
    );
  }

  // ---- 调试：记录所有请求的 URL / 方法 / content-type，便于定位真正的历史接口 ----
  const calls = [];
  function record(entry) {
    calls.push({ ...entry, at: Date.now() });
    if (calls.length > 400) calls.shift();
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__dshExporter !== true) return;
    if (data.kind === 'dump-calls') {
      window.postMessage({ __dshExporter: true, kind: 'calls', calls, samples }, 'https://chat.deepseek.com');
    }
  });

  function sessionIdFromUrl() {
    const match = /\/chat\/s\/([0-9a-f-]{8,})/i.exec(location.pathname || '');
    return match ? match[1] : null;
  }

  // 读取 /api/v0/chat/completion 的流，边读边用补丁协议累积
  async function readEventStream(url, res) {
    try {
      const body = res.clone().body;
      if (!body) return;
      const reader = body.getReader();
      const decoder = new TextDecoder();
      const state = window.DshStreamParser.createState();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === '[DONE]') continue;
            let payload;
            try {
              payload = JSON.parse(raw);
            } catch {
              continue;
            }
            window.DshStreamParser.apply(payload, state);
          }
        }
      }
      const out = window.DshStreamParser.result(state);
      if (!out.content && !out.thinking) return;
      window.postMessage(
        {
          __dshExporter: true,
          kind: 'stream',
          sessionId: sessionIdFromUrl(),
          message: {
            role: 'assistant',
            content: out.content,
            thinking: out.thinking,
            files: [],
            time: Date.now(),
            messageId: out.messageId,
          },
        },
        'https://chat.deepseek.com'
      );
      record({ via: 'stream', method: 'GET', url: String(url), type: 'event-stream', status: res.status, chars: out.content.length });
    } catch {
      /* 流解析失败不能影响页面 */
    }
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const input = args[0];
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(args[1]?.method ?? (typeof input === 'object' && input?.method) ?? 'GET').toUpperCase();
    const promise = originalFetch.apply(this, args);
    try {
      promise.then(
        (res) => {
          // 不再按 content-type 过滤：DeepSeek 有些接口回的是 text/javascript
          const type = res.headers.get('content-type') || '';
          record({ via: 'fetch', method, url: String(url), type, status: res.status });
          if (type.includes('event-stream')) {
            readEventStream(url, res);
            return;
          }
          res
            .clone()
            .text()
            .then((text) => handleText(url, text))
            .catch(() => {});
        },
        () => {}
      );
    } catch {
      /* 嗅探失败绝不影响页面本身 */
    }
    return promise;
  };

  const OriginalXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OriginalXHR();
    let url = '';
    const open = xhr.open;
    xhr.open = function (method, target, ...rest) {
      url = String(target);
      return open.call(this, method, target, ...rest);
    };
    xhr.addEventListener('load', () => {
      try {
        const type = xhr.getResponseHeader('content-type') || '';
        if (xhr.responseType && xhr.responseType !== 'text' && xhr.responseType !== 'json') return;
        const text = xhr.responseType === 'json' ? JSON.stringify(xhr.response) : xhr.responseText;
        record({ via: 'xhr', method: 'GET', url, type, status: xhr.status });
        handleText(url, text);
      } catch {
        /* ignore */
      }
    });
    return xhr;
  }
  PatchedXHR.prototype = OriginalXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;
})();
