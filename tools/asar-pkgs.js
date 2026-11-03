const fs = require('fs');

const asarPath = 'D:\\New APPs\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(asarPath, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const hbuf = Buffer.alloc(headerSize);
fs.readSync(fd, hbuf, 0, headerSize, 16);
const header = JSON.parse(hbuf.toString('utf8'));

const dirs = new Set();
function walk(node, prefix) {
  if (!node.files) return;
  for (const [name, child] of Object.entries(node.files)) {
    const p = prefix + '/' + name;
    if (child.files) {
      const m = p.match(/^\/dsh\/node_modules\/@deepseek-ai\/([^/]+)$/);
      if (m) dirs.add(m[1]);
      walk(child, p);
    }
  }
}
walk(header, '');

const re = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const list = [...dirs].sort().filter((d) => !re || re.test(d));
console.log('COUNT=' + list.length);
for (const d of list) console.log(d);
