import fs from 'node:fs';
import zlib from 'node:zlib';

function readSession(file) {
  const buf = fs.readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const offs = [];
  for (let i = -1; (i = buf.indexOf(magic, i + 1)) !== -1;) offs.push(i);
  let text = '';
  for (let k = 0; k < offs.length; k++) {
    text += zlib.zstdDecompressSync(buf.slice(offs[k], offs[k + 1] ?? buf.length)).toString('utf8');
  }
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const file = process.argv[2];
const rows = readSession(file);
const events = rows.slice(1);

const users = events.filter((e) => e.type === 'user/message');
const assistants = events.filter((e) => e.type === 'assistant/message');
const turns = events.filter((e) => e.type === 'turn/end');

const userChars = users.reduce((s, e) => s + e.data.content.reduce((n, b) => n + (b.text || '').length, 0), 0);
const assistantChars = assistants.reduce((s, e) => s + e.data.message.content.reduce((n, b) => n + (b.text || '').length, 0), 0);

console.log('事件:', events.length);
console.log('user 条数:', users.length, '| 字符:', userChars);
console.log('assistant 条数:', assistants.length, '| 字符:', assistantChars);
console.log('轮次:', turns.length);
console.log('总字符:', userChars + assistantChars);

const longestUser = users.reduce((a, b) => {
  const la = a.data.content.reduce((n, x) => n + (x.text || '').length, 0);
  const lb = b.data.content.reduce((n, x) => n + (x.text || '').length, 0);
  return lb > la ? b : a;
});
const lu = longestUser.data.content.map((b) => b.text).join('');
console.log('最长 user 消息:', lu.length, '字符');
console.log('  结尾:', JSON.stringify(lu.slice(-60)));

const longestAssistant = assistants.reduce((a, b) => {
  const la = a.data.message.content.reduce((n, x) => n + (x.text || '').length, 0);
  const lb = b.data.message.content.reduce((n, x) => n + (x.text || '').length, 0);
  return lb > la ? b : a;
});
const la = longestAssistant.data.message.content.map((b) => b.text).join('');
console.log('最长 assistant 消息:', la.length, '字符');
console.log('  结尾:', JSON.stringify(la.slice(-60)));

console.log('首条 user:', JSON.stringify(users[0].data.content[0].text.slice(0, 50)));
const lastAssistant = assistants[assistants.length - 1].data.message.content.map((b) => b.text).join('');
console.log('末条 assistant:', JSON.stringify(lastAssistant.slice(0, 50)));
