/**
 * dsh-deepseek-import 的 Host 插件入口。
 *
 * 提供一个模型可调用的工具：把 Edge 扩展导出的 DeepSeek 对话 JSON
 * 重建为当前工作区里的 DSH 会话。
 *
 * 关于 defineTool：正常情况下由宿主提供 `@deepseek-ai/dsh-tools`。
 * 但该包不在 profile 的 node_modules 里（核心包在 app.asar 内），
 * 所以这里做惰性加载：拿不到就退回一个等价的本地实现，
 * 保证插件不会因为一条 import 就加载失败。
 */

/** Cordis 插件名 */
export const name = 'dsh-deepseek-import';

/** 需要工具注册表 */
export const inject = ['tools'];

/** 参数 DSL（与 defineTool 接受的形状一致） */
const PARAMETERS = {
  file: {
    type: 'string',
    description: 'Absolute path to a dsh-deepseek-*.json export. Renamed exports are recognised by their content.',
    required: true,
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
};

/** 惰性加载 defineTool；宿主没提供时退回本地实现 */
async function resolveDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools');
    if (typeof mod.defineTool === 'function') return mod.defineTool;
  } catch {
    /* 宿主的核心包不在 profile 的 node_modules 里，属正常情况 */
  }
  // 本地最小实现：把参数 DSL 转成 JSON Schema，其余字段原样透传
  return (options) => {
    const properties = {};
    const required = [];
    for (const [key, spec] of Object.entries(options.parameters || {})) {
      properties[key] = { type: spec.type, description: spec.description };
      if (spec.required === true) required.push(key);
    }
    return {
      ...options,
      parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
    };
  };
}

/**
 * 注册 import_deepseek_chat。
 * @param ctx - 工具注册表
 * @param config - 插件配置（当前未使用）
 */
export async function apply(ctx, config = {}) {
  void config;
  const defineTool = await resolveDefineTool();

  ctx.tools.register(
    defineTool({
      name: 'import_deepseek_chat',
      description:
        'Import a DeepSeek web chat export (the JSON produced by the dsh-deepseek-import Edge extension) into DeepSeek Harness as new session(s) in the current workspace. Returns the created session ids and the workspace. New sessions become visible in the sidebar on the next session-list refresh; if they do not appear, restart DSH.',
      parameters: PARAMETERS,
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
