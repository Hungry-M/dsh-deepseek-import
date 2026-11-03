import fs from 'node:fs';
import path from 'node:path';

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
    else files.push({ path: p, size: child.size, offset: child.offset });
  }
}
walk(header, '');

const destRoot = path.resolve('verify/node_modules/@deepseek-ai');
for (const pkg of process.argv.slice(2)) {
  const prefix = `/dsh/node_modules/@deepseek-ai/${pkg}/`;
  const own = files.filter((f) => f.path.startsWith(prefix) && (/\.(js|mjs|cjs|json)$/i.test(f.path)));
  for (const f of own) {
    const rel = f.path.slice(prefix.length);
    const out = path.join(destRoot, pkg, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const b = Buffer.alloc(f.size);
    fs.readSync(fd, b, 0, f.size, BASE + Number(f.offset));
    fs.writeFileSync(out, b);
  }
  console.log(`copied ${pkg}: ${own.length} files`);
}

