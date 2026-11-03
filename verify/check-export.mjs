import fs from 'node:fs';

const file = process.argv[2];
const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

for (const conv of raw.conversations || []) {
  const messages = conv.messages || [];
  console.log('==', conv.title, '| id', conv.id);
  console.log('messages:', messages.length);

  const ids = messages.map((m) => m.messageId).filter((v) => typeof v === 'number');
  const nums = [...ids].sort((a, b) => a - b);
  const unique = new Set(nums);
  const min = nums[0];
  const max = nums[nums.length - 1];
  console.log('messageId 范围:', min, '→', max, '| 去重后:', unique.size);

  const gaps = [];
  for (let i = min; i <= max; i++) {
    if (!unique.has(i) && gaps.length < 15) gaps.push(i);
  }
  let missing = 0;
  for (let i = min; i <= max; i++) if (!unique.has(i)) missing++;
  console.log('id 缺口数:', missing, '| 前几个:', gaps.join(','));

  const roles = messages.reduce((acc, m) => ((acc[m.role] = (acc[m.role] || 0) + 1), acc), {});
  console.log('角色:', JSON.stringify(roles));

  const withThinking = messages.filter((m) => m.thinking && m.thinking.trim()).length;
  const files = messages.flatMap((m) => m.files || []);
  console.log('思考段数:', withThinking, '| 附件条目:', files.length, '| 已内嵌:', files.filter((f) => f.dataUrl).length);

  const lens = messages.map((m) => (m.content || '').length).sort((a, b) => b - a);
  console.log('最长 5 条正文:', lens.slice(0, 5).join(', '));
  console.log('总字符:', messages.reduce((s, m) => s + (m.content || '').length, 0));

  console.log('首条:', messages[0]?.role, JSON.stringify((messages[0]?.content || '').slice(0, 60)));
  console.log('末条:', messages[messages.length - 1]?.role, JSON.stringify((messages[messages.length - 1]?.content || '').slice(0, 60)));

  const emptyContent = messages.filter((m) => !(m.content || '').trim()).length;
  console.log('空正文条数:', emptyContent);
}
