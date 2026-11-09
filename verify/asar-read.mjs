import fs from 'node:fs';

// asar 路径由环境变量提供：安装位置因人而异
const asar = process.env.DSH_ASAR;
if (!asar || !fs.existsSync(asar)) {
  console.error('请设置 DSH_ASAR 指向 DSH 的 app.asar，例如：');
  console.error('   = "C:\\...\\DeepSeek Harness\\resources\\app.asar"');
  process.exit(1);
}
const fd = fs.openSync(asar, 'r');
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
  return b.toString('utf8');
}

const target = process.argv[2];
const text = get(target);
const lines = text.split('\n');
const keyword = process.argv[3];
if (keyword) {
  lines.forEach((line, i) => {
    if (line.includes(keyword)) {
      console.log(String(i + 1).padStart(5), line.trim().slice(0, 200));
    }
  });
} else {
  console.log(text.slice(0, 3000));
}
