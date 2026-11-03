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
  if (f.unpacked) {
    return fs.readFileSync('D:\\New APPs\\DeepSeek Harness\\resources\\app.asar.unpacked' + f.path);
  }
  const buf = Buffer.alloc(f.size);
  fs.readSync(fd, buf, 0, f.size, BASE + Number(f.offset));
  return buf;
}

const outDir = 'D:\\Documents\\deepseek-harness\\default-workspace\\extracted';
fs.mkdirSync(outDir, { recursive: true });

// 1) all files of the permission-presets package
const pkgPrefix = '/dsh/node_modules/@deepseek-ai/dsh-client-ui-permission-presets/';
const pkgFiles = files.filter((f) => f.path.startsWith(pkgPrefix));
console.log('=== FILES IN dsh-client-ui-permission-presets (' + pkgFiles.length + ') ===');
for (const f of pkgFiles) console.log(f.size + '\t' + f.path);

// 2) packages whose name suggests permissions/sandbox/approval
const dirs = new Set();
for (const f of files) {
  const m = f.path.match(/^\/dsh\/node_modules\/@deepseek-ai\/([^/]+)\//);
  if (m && /(permission|sandbox|approval|policy)/i.test(m[1])) dirs.add(m[1]);
}
console.log('=== RELATED PACKAGES ===');
for (const d of [...dirs].sort()) console.log(d);

// 3) extract text files of the presets package
for (const f of pkgFiles) {
  if (!/\.(js|mjs|cjs|json|d\.ts|md)$/.test(f.path)) continue;
  if (f.size > 3 * 1024 * 1024) continue;
  const rel = f.path.slice(pkgPrefix.length).replace(/[\\/]/g, '__');
  fs.writeFileSync(path.join(outDir, 'presets__' + rel), readFile(f));
  console.log('EXTRACTED ' + rel + ' <- ' + f.size);
}
