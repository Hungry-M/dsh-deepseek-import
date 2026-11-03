const fs = require('fs');

const asarPath = 'D:\\New APPs\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(asarPath, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const hbuf = Buffer.alloc(headerSize);
fs.readSync(fd, hbuf, 0, headerSize, 16);
const header = JSON.parse(hbuf.toString('utf8'));
const BASE = 16 + headerSize;

const files = [];
function walk(node, prefix) {
  if (!node.files) return;
  for (const [name, child] of Object.entries(node.files)) {
    const p = prefix + '/' + name;
    if (child.files) walk(child, p);
    else files.push({ path: p, size: child.size, offset: child.offset, unpacked: child.unpacked });
  }
}
walk(header, '');

const needles = ['workspace-write', 'danger-full-access', 'read-only', 'autoApprove', 'approvalPolicy', 'approval-policy'];

function readRange(offset, size) {
  const buf = Buffer.alloc(size);
  fs.readSync(fd, buf, 0, size, BASE + Number(offset));
  return buf;
}

const results = new Map();
let scanned = 0;
for (const f of files) {
  if (!/\.(js|mjs|cjs|d\.ts)$/.test(f.path)) continue;
  if (!f.path.includes('@deepseek-ai/')) continue;
  if (f.size > 4 * 1024 * 1024) continue;
  let text;
  try {
    if (f.unpacked) {
      text = fs.readFileSync('D:\\New APPs\\DeepSeek Harness\\resources\\app.asar.unpacked' + f.path, 'utf8');
    } else {
      text = readRange(f.offset, f.size).toString('utf8');
    }
  } catch { continue; }
  scanned++;
  for (const n of needles) {
    let idx = -1;
    const hits = [];
    while ((idx = text.indexOf(n, idx + 1)) !== -1 && hits.length < 3) {
      const start = Math.max(0, idx - 120);
      const end = Math.min(text.length, idx + n.length + 120);
      hits.push(text.slice(start, end).replace(/\s+/g, ' ').trim());
    }
    if (hits.length) {
      const key = f.path + ' :: ' + n;
      results.set(key, hits);
    }
  }
}

console.log('SCANNED=' + scanned + ' MATCH_KEYS=' + results.size);
for (const [key, hits] of results) {
  console.log('--- ' + key);
  for (const h of hits) console.log('    ' + h.slice(0, 260));
}
