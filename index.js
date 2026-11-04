/**
 * dsh-deepseek-import 的 Host 插件入口。
 *
 * 提供一个模型可调用的工具：把 Edge 扩展导出的 DeepSeek 对话 JSON
 * 重建为当前工作区里的 DSH 会话。
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

/** Cordis 插件名 */
export const name = 'dsh-deepseek-import';

/** 需要工具注册表 */
export const inject = ['tools'];

/**
 * 注册 import_deepseek_chat。
 * @param ctx - 工具注册表（以及可选的 session/agent 服务）
 * @param config - 插件配置（当前未使用）
 */
export function apply(ctx, config = {}) {
  void config;

  ctx.tools.register(
    defineTool({
      name: 'import_deepseek_chat',
      description:
        'Import a DeepSeek web chat export (the JSON produced by the dsh-deepseek-import Edge extension) into DeepSeek Harness as new session(s) in the current workspace. Returns the created session ids and the sidecar paths (thinking/transcript/references). New sessions become visible in the sidebar on the next session-list refresh; if they do not appear, restart DSH.',
      parameters: {
        file: {
          type: 'string',
          description: 'Absolute path to a dsh-deepseek-*.json export. Renamed exports are recognised by their content.',
        },
        workspace: {
          type: 'string',
          description: 'Target workspace directory. Omit to use the calling session working directory.',
        },
        tail: {
          type: 'number',
          description: 'Import only the last N turns of each conversation (recommended for very long chats).',
        },
        fromMatch: {
          type: 'string',
          description: 'Start the branch at the first user message containing this text.',
        },
        keepInterrupted: {
          type: 'boolean',
          description: 'Keep partial interrupted assistant output instead of a placeholder.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Parse and report only; write nothing.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            created: { type: 'array', items: { type: 'string' }, required: true },
            workspace: { type: 'string', required: true },
            message: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        const workspace =
          args.workspace ||
          exec?.agent?.cwd ||
          exec?.agent?.workingDirectory ||
          exec?.cwd ||
          process.cwd();

        const { runImport } = await import(new URL('./dsh-import.mjs', import.meta.url).href);
        const result = await runImport({
          files: [args.file],
          workspacePath: workspace,
          dryRun: args.dryRun === true,
          tail: args.tail,
          fromMatch: args.fromMatch,
          keepInterrupted: args.keepInterrupted === true,
        });

        const created = (result?.created ?? []).map((item) =>
          typeof item === 'string' ? item : item.sessionId
        );
        return {
          ok: created.length > 0,
          created,
          workspace,
          message: created.length
            ? `已导入 ${created.length} 个会话。侧栏下次刷新可见；若没有出现，重启 DSH。`
            : '没有创建任何会话，请检查导出文件是否包含消息。',
        };
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'import_deepseek_chat',
        rawInput: args,
      }),
    })
  );
}
