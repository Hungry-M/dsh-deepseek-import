import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const conv = raw.conversations[0];
const messages = conv.messages || [];

let sameAdjacent = 0;
for (let i = 1; i < messages.length; i++) {
  if (messages[i].role === messages[i - 1].role) {
    sameAdjacent++;
    if (sameAdjacent <= 6) {
      console.log(
        `连续同角色 #${i - 1}/${i}:`,
        messages[i - 1].role,
        '|',
        JSON.stringify((messages[i - 1].content || '').slice(0, 30)),
        '→',
        JSON.stringify((messages[i].content || '').slice(0, 30))
      );
    }
  }
}
console.log('连续同角色处:', sameAdjacent, '/', messages.length - 1);

// 缺号段
const ids = new Set(messages.map((m) => m.messageId).filter((v) => typeof v === 'number'));
const runs = [];
let start = null;
for (let i = 1; i <= 255; i++) {
  if (!ids.has(i)) {
    if (start === null) start = i;
  } else if (start !== null) {
    runs.push(`${start}-${i - 1}`);
    start = null;
  }
}
if (start !== null) runs.push(`${start}-255`);
console.log('缺号段:', runs.join(', '));

// 最长的一条
const longest = [...messages].sort((a, b) => (b.content || '').length - (a.content || '').length)[0];
console.log('最长消息:', longest.role, longest.content.length, '字符');
console.log('  开头:', JSON.stringify(longest.content.slice(0, 80)));
console.log('  结尾:', JSON.stringify(longest.content.slice(-80)));
