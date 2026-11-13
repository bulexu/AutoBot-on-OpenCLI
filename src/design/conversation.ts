import type { DesignTurn, RpaProposal, RpaTurn } from './model.ts';
import { parseCurl, responseShape } from './source.ts';

type DesignInput = {
  curl: string;
  sample: string;
  goal: string;
  readOnlyPost: boolean;
  reuseCredentials?: true;
};
type DesignResult = { ready: boolean; message?: string };
type Guide = (turns: DesignTurn[], nextMaterial: string) => Promise<string>;
type Design = (input: DesignInput) => Promise<DesignResult>;

export class DesignConversation {
  private curl = '';
  private sample = '';
  private goal = '';
  private readOnlyPost = false;
  private awaitingPostConfirmation = false;
  private reuseCredentials = false;

  private turns: DesignTurn[] = [];

  async send(
    message: string,
    design: Design,
    guide?: Guide,
  ): Promise<{ reply: string; confirmPost?: boolean; result?: DesignResult }> {
    const text = message.trim();
    if (!text || text.length > 128_000) throw new Error('消息为空或过长');

    // Keep raw cURL and samples in the main process. The design agent receives their sanitized shape.
    const blocks = [...text.matchAll(/```(?:bash|sh|shell|curl|json)?[ \t]*\r?\n([\s\S]*?)```/gi)];
    const parts = blocks.map((match) => match[1].trim());
    const prose = text
      .replace(/```(?:bash|sh|shell|curl|json)?[ \t]*\r?\n[\s\S]*?```/gi, '')
      .trim();
    if (prose) parts.push(prose);
    const conversationalParts: string[] = [];

    for (const part of parts) {
      if (/^curl\s/.test(part)) {
        this.curl = part;
        this.readOnlyPost = false;
        this.awaitingPostConfirmation = false;
      } else if (/^[\[{]/.test(part)) {
        responseShape(part);
        this.sample = part;
      } else if (part === '使用当前流程凭证试跑') {
        this.reuseCredentials = true;
      } else if (part === '确认只读 POST' && this.awaitingPostConfirmation) {
        this.readOnlyPost = true;
        this.awaitingPostConfirmation = false;
      } else {
        if (
          /\bcurl\s+(?:-|https?:\/\/)|(?:password|authorization|cookie|(?:api|secret)[_ -]?key|密码|验证码)\s*[:：=]\s*\S|\bBearer\s+\S/i.test(
            part,
          )
        ) {
          throw new Error('请移除描述中的凭证，并将 cURL 放在独立消息或代码块中');
        }
        conversationalParts.push(part);
        const combined = [this.goal, part].filter(Boolean).join('\n');
        if (combined.length > 4000) throw new Error('同步目标过长，请新建会话并简化目标');
        this.goal = combined;
      }
    }

    const userText =
      conversationalParts
        .join('\n')
        .replace(/\b(?:tbl[A-Za-z0-9]+|[A-Za-z0-9]{20,})\b/g, '[本机标识]') ||
      '已在客户端提交接口资料。';
    this.turns.push({ role: 'human', text: userText });
    this.turns = this.turns.slice(-12);
    const ask = async (nextMaterial: string) => {
      const reply = guide
        ? await guide(this.turns, nextMaterial).catch(
            () => '模型暂未回复，资料已保留。' + nextMaterial,
          )
        : nextMaterial;
      this.turns.push({ role: 'assistant', text: reply });
      return { reply };
    };

    if (!this.goal)
      return ask('你希望这个流程完成什么任务？可以告诉我同步的字段和用来匹配记录的键。');
    if (!this.curl) return ask('请贴一条源 API 的 cURL 请求。我会在本机提取请求头凭证。');
    try {
      parseCurl(this.curl, this.readOnlyPost);
    } catch (error) {
      const message = error instanceof Error ? error.message : '请检查 cURL 格式';
      if (message.includes('明确确认只读')) {
        this.awaitingPostConfirmation = true;
        return {
          reply: '该请求使用 POST。若它仅查询数据，请确认后继续。',
          confirmPost: true,
        };
      }
      return { reply: message };
    }
    if (!this.sample)
      return ask('请贴一份脱敏的 JSON 响应。接口有分页时，可以补充下一页字段和停止规则。');

    const result = await design({
      curl: this.curl,
      sample: this.sample,
      goal: this.goal,
      readOnlyPost: this.readOnlyPost,
      ...(this.reuseCredentials ? { reuseCredentials: true } : {}),
    });
    return {
      reply: result.ready
        ? '只读试跑已通过。请核对草稿和预览，然后在工作台确认导出。'
        : (result.message ?? '试跑尚未通过。请补充接口细节或更换响应样例。'),
      result,
    };
  }
}

export class RpaConversation {
  private turns: RpaTurn[] = [];

  async send(message: string, propose: (turns: RpaTurn[]) => Promise<RpaProposal>) {
    const text = message.trim();
    if (!text || text.length > 4000) throw new Error('消息为空或过长');
    if (
      /^curl\s|(?:password|authorization|cookie|api[_ -]?key|密码|验证码)\s*[:：=]\s*\S/i.test(text)
    ) {
      throw new Error('请描述浏览器操作，并移除凭证或验证码');
    }
    const turns: RpaTurn[] = [...this.turns, { role: 'human', text }];
    const result = await propose(turns);
    const response = result.steps.length ? JSON.stringify(result) : result.reply;
    turns.push({ role: 'assistant', text: response });
    this.turns = turns.slice(-12);
    return result;
  }
}
