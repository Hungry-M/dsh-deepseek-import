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

function get(p) {
  let n = header;
  for (const seg of p.split('/').filter(Boolean)) n = n.files[seg];
  const b = Buffer.alloc(n.size);
  fs.readSync(fd, b, 0, n.size, BASE + Number(n.offset));
  return b.toString();
}

for (const pkg of ['dsh-llm-deepseek', 'dsh-llm-deepseek-account', 'dsh-llm-deepseek-api-key']) {
  try {
    const t = get(`/dsh/node_modules/@deepseek-ai/${pkg}/lib/index.js`);
    const values = [...t.matchAll(/context(?:Window)?["']?\s*[:=]\s*(\d{4,7})/g)].map((m) => m[1]);
    const models = [...t.matchAll(/["'](deepseek-[a-z0-9.-]+)["']/g)].map((m) => m[1]);
    console.log(pkg);
    console.log('  context 值:', [...new Set(values)].slice(0, 10).join(', ') || '(none)');
    console.log('  模型名:', [...new Set(models)].slice(0, 10).join(', ') || '(none)');
  } catch {
    console.log(pkg, 'not found');
  }
}
