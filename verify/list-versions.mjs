import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const messages = raw.conversations[0].messages || [];

const groups = new Map();
for (const [index, m] of messages.entries()) {
  const role = m.role === 'assistant' ? 'assistant' : 'user';
  const key = m.parentId === null || m.parentId === undefined ? `#${index}|${role}` : `${m.parentId}|${role}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ index, role, m });
}

const multi = [...groups.values()].filter((list) => list.length > 1);
console.log(`多版本组：${multi.length} 处，被丢弃：${multi.reduce((s, l) => s + l.length - 1, 0)} 条\n`);

multi.forEach((list, i) => {
  const kept = list[list.length - 1];
  console.log(`【${i + 1}】${kept.role} · 版本数 ${list.length} · 位置 #${kept.index}`);
  list.forEach((item, j) => {
    const text = (item.m.content || '').replace(/\s+/g, ' ').slice(0, 70);
    const mark = j === list.length - 1 ? '保留' : '丢弃';
    console.log(`   ${mark}: ${JSON.stringify(text)}${(item.m.content || '').length > 70 ? '…' : ''}`);
  });
  console.log('');
});
