import fs from 'node:fs';

const asar = 'D:\\New APPs\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(asar, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const hbuf = Buffer.alloc(headerSize);
fs.readSync(fd, hbuf, 0, headerSize, 16);
const header = JSON.parse(hbuf.toString('utf8'));
const BASE = 16 + headerSize;

function walk(node, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(node.files || {})) {
    const p = `${prefix}/${key}`;
    if (value.files) out.push(...walk(value, p));
    else out.push({ path: p, size: value.size, offset: Number(value.offset) });
  }
  return out;
}
const all = walk(header);
const pattern = new RegExp(process.argv[2], 'i');
const only = process.argv[3] || '.js';
const hits = all.filter((f) => pattern.test(f.path) && f.path.endsWith(only));
console.log(`匹配 ${hits.length} 个文件`);
for (const hit of hits.slice(0, 25)) {
  console.log(hit.path, `(${Math.round(hit.size / 1024)} KB)`);
}
