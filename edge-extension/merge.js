/**
 * 分页窗口的合并逻辑（纯函数，浏览器与 Node 都能跑）。
 *
 * 背景：超长对话是分页加载的，每次捕获拿到的是「某一页 + 相邻几条」的窗口，
 * 不是整段对话。按数组下标对齐的合并会拿新窗口覆盖老窗口，于是越往上翻、
 * 早先抓到的内容反而丢了。
 *
 * 这里按「消息身份」合并：
 *   1. 都有 message_id → 按 id 取并集，按 id 排序（DeepSeek 的 id 是自增整数）
 *   2. 没有 id（DOM 兜底）→ 用 角色+正文 的指纹做重叠拼接，只在前缀/后缀对齐处拼
 */
(function (root) {
  const SEP = '\u0000\u0001';

  function score(message) {
    return (message?.content || '').length + (message?.thinking || '').length;
  }

  /** 同一消息的两份副本：正文取更全的，附件取并集 */
  function unionFiles(a, b) {
    const merged = [];
    const seen = new Set();
    for (const file of [...(a || []), ...(b || [])]) {
      const key = file?.dataUrl ? String(file.dataUrl).slice(0, 64) : file?.url || file?.name;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(file);
    }
    return merged;
  }

  function richer(a, b) {
    if (!a) return b;
    if (!b) return a;
    const winner = score(b) > score(a) ? b : a;
    const files = unionFiles(a.files, b.files);
    return files.length ? { ...winner, files } : winner;
  }

  function keyOf(message) {
    return `${message?.role || ''}${SEP}${String(message?.content || '').trim()}`;
  }

  function hasId(message) {
    return message && message.messageId !== null && message.messageId !== undefined && message.messageId !== '';
  }

  /** 找 prev 的后缀与 next 的前缀的最长重叠（向上翻页时 next 更早） */
  function overlapSuffixPrefix(prevKeys, nextKeys) {
    const max = Math.min(prevKeys.length, nextKeys.length);
    for (let k = max; k > 0; k -= 1) {
      let same = true;
      for (let i = 0; i < k; i += 1) {
        if (prevKeys[prevKeys.length - k + i] !== nextKeys[i]) {
          same = false;
          break;
        }
      }
      if (same) return k;
    }
    return 0;
  }

  function stitch(prev, next) {
    if (!prev.length) return next;
    if (!next.length) return prev;

    const prevKeys = prev.map(keyOf);
    const nextKeys = next.map(keyOf);

    // prev 尾部 == next 头部：next 是后续页
    const forward = overlapSuffixPrefix(prevKeys, nextKeys);
    if (forward > 0) {
      const merged = [...prev];
      for (const message of next.slice(forward)) merged.push(message);
      return merged;
    }

    // next 尾部 == prev 头部：next 是更早的页
    const backward = overlapSuffixPrefix(nextKeys, prevKeys);
    if (backward > 0) {
      const merged = [...next];
      for (const message of prev.slice(backward)) merged.push(message);
      return merged;
    }

    // 完全没重叠：按「向上翻页」的常见情况把 next 拼在前面
    return [...next, ...prev];
  }

  function dedupe(messages) {
    const out = [];
    const index = new Map();
    for (const message of messages) {
      const key = keyOf(message);
      const hit = index.get(key);
      if (hit === undefined) {
        index.set(key, out.length);
        out.push(message);
      } else {
        out[hit] = richer(out[hit], message);
      }
    }
    return out;
  }

  function mergeMessages(prev, next) {
    const a = Array.isArray(prev) ? prev.filter(Boolean) : [];
    const b = Array.isArray(next) ? next.filter(Boolean) : [];
    if (!a.length) return dedupe(b);
    if (!b.length) return dedupe(a);

    const combined = [...a, ...b];
    if (combined.every(hasId)) {
      const byId = new Map();
      for (const message of combined) {
        const id = String(message.messageId);
        byId.set(id, byId.has(id) ? richer(byId.get(id), message) : message);
      }
      return [...byId.values()].sort((x, y) => Number(x.messageId) - Number(y.messageId));
    }

    // 一边来自接口（有 id）、一边来自 DOM（没有 id）：
    // 以有 id 的一边为骨架，DOM 里多出来的按「后面最近的已匹配项」插进去。
    const idSide = combined.filter(hasId);
    const plainSide = combined.filter((message) => !hasId(message));
    if (idSide.length && plainSide.length) {
      const byId = new Map();
      for (const message of idSide) {
        const id = String(message.messageId);
        byId.set(id, byId.has(id) ? richer(byId.get(id), message) : message);
      }
      const base = [...byId.values()].sort((x, y) => Number(x.messageId) - Number(y.messageId));
      return mergePlainIntoBase(base, plainSide);
    }

    return dedupe(stitch(a, b));
  }

  /** 把没有 id 的消息按内容锚点插进有 id 的骨架里 */
  function mergePlainIntoBase(base, plainMessages) {
    const positionByKey = new Map();
    base.forEach((message, index) => positionByKey.set(keyOf(message), index));

    const entries = base.map((message, index) => ({ order: index, message }));
    let tail = 0;

    for (let i = 0; i < plainMessages.length; i += 1) {
      const message = plainMessages[i];
      const key = keyOf(message);
      if (positionByKey.has(key)) {
        const at = positionByKey.get(key);
        entries[at].message = richer(entries[at].message, message);
        continue;
      }

      // 找它后面最近的已匹配消息，插到那个锚点之前
      let anchor = null;
      for (let j = i + 1; j < plainMessages.length; j += 1) {
        const nextKey = keyOf(plainMessages[j]);
        if (positionByKey.has(nextKey)) {
          anchor = positionByKey.get(nextKey);
          break;
        }
      }

      if (anchor === null) {
        tail += 1;
        entries.push({ order: base.length + tail / 1000, message });
      } else {
        entries.push({ order: anchor - (plainMessages.length - i) / 10000, message });
      }
    }

    return entries.sort((x, y) => x.order - y.order).map((entry) => entry.message);
  }

  root.DshMerge = { mergeMessages };
})(typeof globalThis !== 'undefined' ? globalThis : this);
