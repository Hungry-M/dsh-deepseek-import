import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

// 用法：node verify/test-system-head.mjs <session.v4.jsonl.zstd>
// 模拟「导入后继续对话」：在日志末尾追加一条 system/message，再用 DSH 的校验器判定。
const file = process.argv[2];
const buf = fs.readFileSync(file);
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const offsets = [];
for (let i = -1; (i = buf.indexOf(magic, i + 1)) !== -1;) offsets.push(i);
let text = '';
for (let k = 0; k < offsets.length; k++) {
  text += zlib.zstdDecompressSync(buf.subarray(offsets[k], offsets[k + 1] ?? buf.length)).toString('utf8');
}
const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const header = rows[0];
const events = rows.slice(1);

const nextSeq = events.length;
const lastTurn = events.reduce((max, e) => (e.data && typeof e.data.turn === 'number' ? Math.max(max, e.data.turn) : max), 0);
const nextTurn = lastTurn + 1;
const appended = [
  ...events,
  { type: 'turn/start', seq: nextSeq, time: Date.now(), data: { turn: nextTurn } },
  { type: 'step/start', seq: nextSeq + 1, time: Date.now(), data: { turn: nextTurn, step: 1 } },
  {
    type: 'system/message',
    seq: nextSeq + 2,
    time: Date.now(),
    data: {
      turn: nextTurn,
      step: 1,
      message: {
        role: 'system',
        content: [{ type: 'text', text: '后续轮次的 system 提示' }],
        source: { kind: 'system-prompt' },
        id: 'test-system-head',
      },
    },
    surfaceOp: 'append',
  },
];

const encoded = Buffer.concat([
  zlib.zstdCompressSync(Buffer.from(JSON.stringify(header) + '\n', 'utf8')),
  ...appended.map((e) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(e) + '\n', 'utf8'))),
]);
const temp = path.join(path.dirname(file), 'system-head-probe.v4.jsonl.zstd');
fs.writeFileSync(temp, encoded);

const { restoreReleasedV4Artifact } = await import('./node_modules/@deepseek-ai/dsh-session-format-v3-to-v4/lib/index.js');
const { type, ...logicalHeader } = header;
const known = new Set(appended.map((e) => e.type));
for (const t of ['developer/message', 'tool/call', 'tool/result', 'assistant/attempt']) known.add(t);
try {
  restoreReleasedV4Artifact({ header: logicalHeader, events: appended, inheritedEventCount: 0 }, known);
  console.log('PASS  追加 system/message 后仍然合法');
} catch (error) {
  console.log('FAIL  ' + error.message);
  process.exitCode = 1;
}
fs.unlinkSync(temp);
