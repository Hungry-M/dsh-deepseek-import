/**
 * DeepSeek 流式补丁协议解析器（纯函数，浏览器与 Node 都能跑）。
 *
 * 协议样本（/api/v0/chat/completion，text/event-stream）：
 *   event: ready
 *   data: {"request_message_id":3,"response_message_id":4}
 *
 *   data: {"v":{"response":{"message_id":4,"fragments":[{"id":2,"type":"THINK","content":"我们需要"}]}}}
 *   data: {"p":"response/fragments/-1/content","o":"APPEND","v":"回答"}
 *   data: {"v":"中文"}          // 无 p/o：沿用上一条的 path 与 APPEND
 *
 * 规则：带 v.response 的是整快照；带 p 的是路径补丁；只有 v 的是对上一个路径的追加。
 */
(function (root) {
  function createState() {
    return { fragments: [], lastPath: null, lastOp: null, messageId: null, status: null };
  }

  function snapshot(response, state) {
    if (typeof response.message_id === 'number') state.messageId = response.message_id;
    if (typeof response.status === 'string') state.status = response.status;
    if (!Array.isArray(response.fragments)) return;
    state.fragments = response.fragments.map((fragment) => ({
      type: fragment?.type || 'RESPONSE',
      content: fragment?.content || '',
    }));
    state.lastPath = `response/fragments/${state.fragments.length - 1}/content`;
    state.lastOp = 'APPEND';
  }

  function fragmentIndex(path, state) {
    const match = /fragments\/(-?\d+)(?:\/|$)/.exec(path || '');
    if (!match) return -1;
    const index = Number(match[1]);
    return index < 0 ? state.fragments.length + index : index;
  }

  function apply(payload, state) {
    if (!payload || typeof payload !== 'object') return;

    if (payload.v && typeof payload.v === 'object' && payload.v.response) {
      snapshot(payload.v.response, state);
      return;
    }

    if (payload.p) {
      state.lastPath = payload.p;
      state.lastOp = payload.o || 'APPEND';
    }
    const path = payload.p || state.lastPath;
    if (!path) return;
    const op = payload.o || state.lastOp || 'APPEND';

    if (/\/fragments$/.test(path) && op === 'APPEND' && payload.v && typeof payload.v === 'object') {
      state.fragments.push({ type: payload.v.type || 'RESPONSE', content: payload.v.content || '' });
      state.lastPath = `response/fragments/${state.fragments.length - 1}/content`;
      state.lastOp = 'APPEND';
      return;
    }

    if (/\/status$/.test(path) && typeof payload.v === 'string') {
      state.status = payload.v;
      return;
    }

    if (/\/content$/.test(path)) {
      const target = state.fragments[fragmentIndex(path, state)];
      if (!target) return;
      if (op === 'SET') target.content = String(payload.v ?? '');
      else target.content += String(payload.v ?? '');
      return;
    }

    if (/\/type$/.test(path) && typeof payload.v === 'string') {
      const target = state.fragments[fragmentIndex(path, state)];
      if (target) target.type = payload.v;
    }
  }

  function result(state) {
    const thinking = state.fragments
      .filter((fragment) => fragment.type === 'THINK')
      .map((fragment) => fragment.content)
      .join('\n')
      .trim();
    const content = state.fragments
      .filter((fragment) => fragment.type !== 'THINK')
      .map((fragment) => fragment.content)
      .join('')
      .trim();
    return { messageId: state.messageId, status: state.status, content, thinking };
  }

  root.DshStreamParser = { createState, apply, result };
})(typeof globalThis !== 'undefined' ? globalThis : this);
