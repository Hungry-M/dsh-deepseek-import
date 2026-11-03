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

function get(p) {
  let n = header;
  for (const seg of p.split('/').filter(Boolean)) n = n.files[seg];
  const b = Buffer.alloc(n.size);
  fs.readSync(fd, b, 0, n.size, BASE + Number(n.offset));
  return b.toString();
}

const path = process.argv[2];
const text = get(path);
for (const name of process.argv.slice(3)) {
  const needle = `"name": "${name}"`;
  const i = text.indexOf(needle);
  if (i === -1) { console.log(`### ${name}: NOT FOUND\n`); continue; }
  const end = text.indexOf('"declaration": "', i);
  let j = end + '"declaration": "'.length;
  let out = '';
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') { out += text[j + 1]; j += 2; continue; }
    if (c === '"') break;
    out += c; j++;
  }
  console.log(`### ${name}\n${out}\n`);
}
