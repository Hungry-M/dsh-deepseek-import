const fs = require('fs');
const path = require('path');

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
  if (f.unpacked) return fs.readFileSync('D:\\New APPs\\DeepSeek Harness\\resources\\app.asar.unpacked' + f.path);
  const buf = Buffer.alloc(f.size);
  fs.readSync(fd, buf, 0, f.size, BASE + Number(f.offset));
  return buf;
}

const pkg = process.argv[2];
const prefix = '/dsh/node_modules/@deepseek-ai/' + pkg + '/';
const outDir = 'D:\\Documents\\deepseek-harness\\default-workspace\\extracted\\' + pkg;
fs.mkdirSync(outDir, { recursive: true });
const list = files.filter((f) => f.path.startsWith(prefix) && !f.path.slice(prefix.length).includes('/node_modules/'));
for (const f of list) {
  if (!/\.(js|mjs|cjs|json|d\.ts)$/.test(f.path)) continue;
  if (f.size > 2 * 1024 * 1024) continue;
  const rel = f.path.slice(prefix.length).replace(/[\\/]/g, '__');
  fs.writeFileSync(path.join(outDir, rel), readFile(f));
  console.log('EXTRACTED ' + rel + ' (' + f.size + ')');
}
