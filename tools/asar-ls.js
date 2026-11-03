const fs = require('fs');

const asarPath = 'D:\\New APPs\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(asarPath, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const hbuf = Buffer.alloc(headerSize);
fs.readSync(fd, hbuf, 0, headerSize, 16);
const header = JSON.parse(hbuf.toString('utf8'));

const prefix = process.argv[2];
const out = [];
function walk(node, p) {
  if (!node.files) return;
  for (const [name, child] of Object.entries(node.files)) {
    const q = p + '/' + name;
    if (child.files) walk(child, q);
    else if (q.startsWith(prefix)) out.push(child.size + '\t' + q);
  }
}
walk(header, '');
console.log('COUNT=' + out.length);
out.forEach((l) => console.log(l));
