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

const outDir = 'D:\\Documents\\deepseek-harness\\default-workspace\\extracted';
fs.mkdirSync(outDir, { recursive: true });

const pkgs = process.argv.slice(2);
for (const pkg of pkgs) {
  const prefix = '/dsh/node_modules/@deepseek-ai/' + pkg + '/';
  const hits = files.filter((f) => f.path.startsWith(prefix) && /README(\.zh)?\.md$/i.test(f.path));
  for (const f of hits) {
    const name = pkg + '__' + path.basename(f.path);
    fs.writeFileSync(path.join(outDir, name), readFile(f));
    console.log('EXTRACTED ' + name + ' (' + f.size + ' bytes)');
  }
  if (!hits.length) console.log('NO README for ' + pkg);
}
