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

function readFile(f) {
  if (f.unpacked) return fs.readFileSync('D:\\New APPs\\DeepSeek Harness\\resources\\app.asar.unpacked' + f.path).toString('utf8');
  const buf = Buffer.alloc(f.size);
  fs.readSync(fd, buf, 0, f.size, BASE + Number(f.offset));
  return buf.toString('utf8');
}

const needles = (process.argv[2] || '').split('|').filter(Boolean);
const maxPerNeedle = Number(process.argv[3] || 6);
const counts = new Map();
needles.forEach((n) => counts.set(n, 0));

for (const f of files) {
  if (!/\.(js|mjs|cjs|json|ya?ml|md|ts)$/.test(f.path)) continue;
  if (f.size > 3 * 1024 * 1024) continue;
  let text;
  try { text = readFile(f); } catch { continue; }
  for (const n of needles) {
    if (counts.get(n) >= maxPerNeedle) continue;
    let idx = text.indexOf(n);
    if (idx === -1) continue;
    counts.set(n, counts.get(n) + 1);
    const start = Math.max(0, idx - 150);
    const end = Math.min(text.length, idx + n.length + 150);
    console.log('[' + n + '] ' + f.path);
    console.log('   ' + text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 320));
  }
}
console.log('DONE ' + JSON.stringify([...counts]));
