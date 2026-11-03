const fs = require('fs');

const asarPath = 'D:\\New APPs\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(asarPath, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const hbuf = Buffer.alloc(headerSize);
fs.readSync(fd, hbuf, 0, headerSize, 16);
const header = JSON.parse(hbuf.toString('utf8'));

const all = [];
function walk(node, prefix) {
  if (!node.files) return;
  for (const [name, child] of Object.entries(node.files)) {
    const p = prefix + '/' + name;
    if (child.files) walk(child, p);
    else all.push({ path: p, size: child.size, offset: child.offset });
  }
}
walk(header, '');

const outside = all.filter((f) => !f.path.includes('/node_modules/'));
console.log('TOTAL=' + all.length + ' OUTSIDE_NODE_MODULES=' + outside.length);

const md = outside.filter((f) => /\.md$/i.test(f.path));
console.log('--- MD FILES (' + md.length + ') ---');
for (const f of md) console.log(f.size + '\t' + f.path);

const re = /(mode|approval|permission|sandbox|policy)/i;
const hits = outside.filter((f) => re.test(f.path));
console.log('--- NAME HITS (' + hits.length + ') ---');
for (const f of hits) console.log(f.size + '\t' + f.path);
