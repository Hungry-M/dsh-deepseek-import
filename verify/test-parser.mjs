import fs from 'node:fs';

const code = fs.readFileSync('edge-extension/stream-parser.js', 'utf8');
const DshStreamParser = new Function(`${code}\n;return globalThis.DshStreamParser;`)();

function run(frames) {
  const state = DshStreamParser.createState();
  for (const frame of frames) DshStreamParser.apply(frame, state);
  return DshStreamParser.result(state);
}

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      期望 ${JSON.stringify(expected)}\n      实际 ${JSON.stringify(actual)}`);
  return ok;
}

let allOk = true;

// 1. 合成流：THINK → RESPONSE 切换
allOk &= check(
  '思考与正文分流',
  run([
    { v: { response: { message_id: 4, status: 'WIP', fragments: [{ id: 1, type: 'THINK', content: '先说' }] } } },
    { p: 'response/fragments/-1/content', o: 'APPEND', v: '前提' },
    { v: '。' },
    { p: 'response/fragments', o: 'APPEND', v: { type: 'RESPONSE', content: '回答' } },
    { v: '正文' },
    { p: 'response/status', o: 'SET', v: 'FINISHED' },
  ]),
  { messageId: 4, status: 'FINISHED', content: '回答正文', thinking: '先说前提。' }
);

// 2. 真实样本（截断在思考片段中间）
// 样本来自真实对话，不进仓库；本地有就跑，CI 上跳过。
if (fs.existsSync('samples/sse-sample.txt')) {
  const sample = fs.readFileSync('samples/sse-sample.txt', 'utf8');
  const state = DshStreamParser.createState();
  for (const line of sample.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      DshStreamParser.apply(JSON.parse(raw), state);
    } catch {
      /* 截断的最后一行 */
    }
  }
  const real = DshStreamParser.result(state);
  allOk &= check('真实样本只解析出思考', real.content, '');
  allOk &= check('真实样本思考非空', real.thinking.length > 0, true);
} else {
  console.log('SKIP  真实样本（samples/sse-sample.txt 不在仓库里）');
}

// 3. SET 覆盖
allOk &= check(
  'SET 覆盖而不是追加',
  run([
    { v: { response: { fragments: [{ type: 'RESPONSE', content: '旧' }] } } },
    { p: 'response/fragments/0/content', o: 'SET', v: '新' },
  ]),
  { messageId: null, status: null, content: '新', thinking: '' }
);

console.log(allOk ? '\n全部通过' : '\n有失败项');
process.exit(allOk ? 0 : 1);
