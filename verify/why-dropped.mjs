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

let dropped = 0;
const droppedSamples = [];
for (const [key, list] of groups) {
  if (list.length > 1) {
    for (const item of list.slice(0, -1)) {
      dropped++;
      if (droppedSamples.length < 8) {
        droppedSamples.push({ key, role: item.role, len: (item.m.content || '').length, head: (item.m.content || '').slice(0, 40) });
      }
    }
  }
}

console.log('消息:', messages.length, '| 组数:', groups.size, '| 会被判为「版本」而丢弃:', dropped);
console.log('有 parentId 的消息:', messages.filter((m) => m.parentId !== null && m.parentId !== undefined).length);
console.log('样例:');
for (const s of droppedSamples) console.log('  ', JSON.stringify(s));

// 空正文
console.log('空正文:', messages.filter((m) => !(m.content || '').trim()).length);
