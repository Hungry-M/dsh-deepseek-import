import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const file = process.argv[2];
const buf = fs.readFileSync(file);
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const offs = [];
for (let i = -1; (i = buf.indexOf(magic, i + 1)) !== -1;) offs.push(i);
let text = '';
for (let k = 0; k < offs.length; k++) {
  text += zlib.zstdDecompressSync(buf.slice(offs[k], offs[k + 1] ?? buf.length)).toString('utf8');
}
const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
for (const row of rows.slice(1)) {
  if (row.type === 'user/message') {
    console.log('USER  :', row.data.content.map((b) => b.text).join(' ').slice(0, 200).replace(/\n/g, ' ⏎ '));
  } else if (row.type === 'assistant/message') {
    console.log('ASSIST:', row.data.message.content.map((b) => b.text).join(' ').slice(0, 200).replace(/\n/g, ' ⏎ '));
  } else if (row.type === 'session/title') {
    console.log('TITLE :', row.data.title);
  }
}
