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
  if (f.unpacked) return fs.readFileSync('D:\\New APPs\\DeepSeek Harness\\resources\\app.asar.unpacked' + f.path);
  const buf = Buffer.alloc(f.size);
  fs.readSync(fd, buf, 0, f.size, BASE + Number(f.offset));
  return buf.toString('utf8');
}

for (const f of files) {
  if (!/\.(ya?ml)$/.test(f.path)) continue;
  if (f.size > 512 * 1024) continue;
  let t;
  try { t = readFile(f); } catch { continue; }
  if (!t.includes('permission-presets')) continue;
  console.log('=== ' + f.path + ' ===');
  const lines = t.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/permission-presets|read-only|workspace-write|danger-full-access|approval|defaultPreset/.test(lines[i])) {
      console.log(String(i + 1).padStart(4) + ': ' + lines[i]);
    }
  }
}
