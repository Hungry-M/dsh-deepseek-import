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

function read(f) {
  const b = Buffer.alloc(f.size);
  fs.readSync(fd, b, 0, f.size, BASE + Number(f.offset));
  return b.toString('utf8');
}

const pkgs = process.argv.slice(2);
for (const pkg of pkgs) {
  const prefix = `/dsh/node_modules/@deepseek-ai/${pkg}/`;
  const own = files.filter((f) => f.path.startsWith(prefix) && f.path.endsWith('.js'));
  console.log(`## ${pkg}`);
  for (const f of own) {
    const t = read(f);
    const imps = [...t.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    const dyn = [...t.matchAll(/import\("([^"]+)"\)/g)].map((m) => m[1]);
    const all = [...new Set([...imps, ...dyn])];
    console.log(`  ${f.path.slice(prefix.length)} -> ${all.join(', ')}`);
  }
}
