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

const target = process.argv[2];
const f = files.find((x) => x.path === target);
if (!f) { console.log('NOT FOUND ' + target); process.exit(1); }
const buf = Buffer.alloc(f.size);
fs.readSync(fd, buf, 0, f.size, BASE + Number(f.offset));
const outDir = 'D:\\Documents\\deepseek-harness\\default-workspace\\extracted';
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, path.basename(target));
fs.writeFileSync(out, buf);
console.log('WROTE ' + out + ' (' + f.size + ' bytes)');
