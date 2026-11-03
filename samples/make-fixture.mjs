import fs from 'node:fs';
import path from 'node:path';

// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// 20000 字的长输入，带序号，方便验证首尾都在
const longInput = Array.from({ length: 500 }, (_, i) => `第 ${i + 1} 行：这是一段用于测试网页折叠长输入是否被完整迁移的占位文本。`).join('\n');
const longTail = 'LONG-INPUT-END-MARKER';

const payload = {
  format: 'dsh-deepseek-export',
  version: 1,
  exportedAt: new Date().toISOString(),
  conversations: [
    {
      id: 'fixture-0001',
      title: '图片文件长输入测试',
      createdAt: 1793600000000,
      updatedAt: 1793601000000,
      messages: [
        {
          role: 'user',
          content: longInput + '\n' + longTail,
          thinking: '',
          files: [],
          time: 1793600000000,
        },
        {
          role: 'assistant',
          content: '收到，这是一段长输入，共 500 行。\n\n```js\nconsole.log("ok")\n```\n\n| 项 | 值 |\n|---|---|\n| 行数 | 500 |',
          thinking: '用户给了一大段占位文本，应该确认收到并概括。',
          files: [],
          time: 1793600060000,
        },
        {
          role: 'user',
          content: '这三样东西帮我存下来',
          thinking: '',
          files: [
            { name: 'screenshot.png', mime: 'image/png', size: 68, dataUrl: `data:image/png;base64,${PNG}` },
            {
              name: '头脑风暴.txt',
              mime: 'text/plain',
              size: 30,
              dataUrl: `data:text/plain;base64,${Buffer.from('文件内容：迁移测试成功', 'utf8').toString('base64')}`,
            },
            { name: '需求文档.pdf', mime: 'application/pdf', size: 204800, url: 'https://cdn.deepseek.com/files/demo.pdf' },
          ],
          time: 1793600100000,
        },
        {
          role: 'assistant',
          content: '两样已落盘，PDF 只有链接，需要你在本地补上。',
          thinking: '图片和 txt 有 dataUrl 可以写盘；PDF 只有 url，按预期应记录名字和大小。',
          files: [],
          time: 1793600200000,
        },
      ],
    },
  ],
};

const out = path.join('samples', 'fixture-files-long.json');
fs.writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(`wrote ${out}`);
console.log(`long input chars: ${longInput.length + longTail.length}`);
