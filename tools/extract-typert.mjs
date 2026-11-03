import fs from 'node:fs';

const asarPath = 'D:\\New APPs\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(asarPath, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const hbuf = Buffer.alloc(headerSize);
fs.readSync(fd, hbuf, 0, headerSize, 16);
const header = JSON.parse(hbuf.toString('utf8'));
const BASE = 16 + headerSize;

function get(p) {
  let n = header;
  for (const seg of p.split('/').filter(Boolean)) n = n.files[seg];
  const b = Buffer.alloc(n.size);
  fs.readSync(fd, b, 0, n.size, BASE + Number(n.offset));
  return b.toString();
}

const t = get('/dsh/node_modules/@deepseek-ai/dsh-agent-preset-registry/lib/typert.host.js');
const needle = process.argv[2];
const before = Number(process.argv[3] ?? 2000);
const after = Number(process.argv[4] ?? 2000);
const i = t.indexOf(needle);
console.log('INDEX', i, 'LEN', t.length);
const seg = t.slice(Math.max(0, i - before), i + after);
console.log(seg.replace(/\\n/g, '\n'));
