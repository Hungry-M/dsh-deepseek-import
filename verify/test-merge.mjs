import fs from 'node:fs';

const code = fs.readFileSync('edge-extension/merge.js', 'utf8');
const DshMerge = new Function(`${code}\n;return globalThis.DshMerge;`)();

const msg = (id, role, content) => ({ messageId: id, role, content, thinking: '' });
const plain = (role, content) => ({ messageId: null, role, content, thinking: '' });

let ok = true;
function check(name, actual, expected) {
  const a = JSON.stringify(actual.map((m) => m.content));
  const e = JSON.stringify(expected);
  const pass = a === e;
  ok = ok && pass;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!pass) console.log(`      期望 ${e}\n      实际 ${a}`);
}

// 1. 分页：先拿到 4-8，再往上翻拿到 1-4
check(
  '按 message_id 合并两页（向上翻页不丢老页）',
  DshMerge.mergeMessages(
    [4, 5, 6, 7, 8].map((i) => msg(i, i % 2 ? 'user' : 'assistant', `m${i}`)),
    [1, 2, 3, 4].map((i) => msg(i, i % 2 ? 'user' : 'assistant', `m${i}`))
  ),
  ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']
);

// 2. 新窗口反而更短：不能覆盖
check(
  '短窗口不覆盖长窗口',
  DshMerge.mergeMessages(
    [1, 2, 3, 4, 5].map((i) => msg(i, 'user', `m${i}`)),
    [3, 4, 5].map((i) => msg(i, 'user', `m${i}`))
  ),
  ['m1', 'm2', 'm3', 'm4', 'm5']
);

// 3. 同一 id 内容更完整（流式补全）
const rich = DshMerge.mergeMessages([{ ...msg(2, 'assistant', '短'), thinking: 'x' }], [{ ...msg(2, 'assistant', '长很多的内容'), thinking: 'xy' }]);
check('同 id 取内容更全的一版', rich, ['长很多的内容']);

// 4. DOM 兜底（无 id）：向上翻页，窗口重叠
check(
  '无 id 时按重叠拼接',
  DshMerge.mergeMessages(
    [plain('user', 'b'), plain('assistant', 'c')],
    [plain('user', 'a'), plain('user', 'b')]
  ),
  ['a', 'b', 'c']
);

// 5. 无 id 且完全不重叠：向上翻页放在前面
check(
  '无 id 且不重叠时拼在前面',
  DshMerge.mergeMessages([plain('user', 'e'), plain('assistant', 'f')], [plain('user', 'a'), plain('assistant', 'b')]),
  ['a', 'b', 'e', 'f']
);

// 6. 接口页（有 id）+ DOM 页（无 id）混合：多出来的按锚点插入
check(
  '混合来源按锚点插入',
  DshMerge.mergeMessages(
    [msg(1, 'user', 'a'), msg(2, 'assistant', 'b'), msg(4, 'assistant', 'd')],
    [plain('user', 'a'), plain('assistant', 'b'), plain('user', 'c'), plain('assistant', 'd')]
  ),
  ['a', 'b', 'c', 'd']
);

console.log(ok ? '\n全部通过' : '\n有失败项');
process.exit(ok ? 0 : 1);
