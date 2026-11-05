import fs from 'node:fs';

const asar = 'D:\\New APPs\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(asar, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const hbuf = Buffer.alloc(headerSize);
fs.readSync(fd, hbuf, 0, headerSize, 16);
const header = JSON.parse(hbuf.toString('utf8'));

function walk(node, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(node.files || {})) {
    const p = `${prefix}/${key}`;
    if (value.files) out.push(...walk(value, p));
    else out.push(p);
  }
  return out;
}

const all = walk(header);
const re = new RegExp(process.argv[2] || 'dev-note', 'i');
const hits = all.filter((p) => re.test(p));
console.log(`共 ${all.length} 个文件，匹配 ${hits.length} 个`);
for (const p of hits.slice(0, 40)) console.log(p);
