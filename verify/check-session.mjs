import fs from 'node:fs';
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
const header = rows[0];
console.log('cwd    :', header.cwd);
console.log('events :', rows.length - 1);

for (const row of rows.slice(1)) {
  if (row.type === 'user/message' || row.type === 'assistant/message') {
    const body = row.type === 'user/message' ? row.data.content : row.data.message.content;
    const textContent = body.map((b) => b.text).join('\n');
    console.log(`\n[${row.type}] len=${textContent.length}`);
    console.log('  head:', JSON.stringify(textContent.slice(0, 60)));
    console.log('  tail:', JSON.stringify(textContent.slice(-60)));
    for (const marker of ['LONG-INPUT-END-MARKER', '附件未下载', '附件已保存']) {
      if (textContent.includes(marker)) console.log('  ✓ 包含', marker);
    }
  }
}
