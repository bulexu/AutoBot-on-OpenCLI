import type { RpaProposal, RpaTurn } from './model.ts';
import { parseCurl, responseShape } from './source.ts';

type DesignInput = { curl: string; sample: string; goal: string; readOnlyPost: boolean };
type DesignResult = { ready: boolean; message?: string };
type Design = (input: DesignInput) => Promise<DesignResult>;

export class DesignConversation {
  private curl = '';
  private sample = '';
  private goal = '';
  private readOnlyPost = false;
  private awaitingPostConfirmation = false;

  async send(message: string, design: Design) {
    const text = message.trim();
    if (!text || text.length > 128_000) throw new Error('消息为空或过长');

    // Keep raw cURL and samples in the main process. The design agent receives their sanitized shape.
    const blocks = [...text.matchAll(/```(?:bash|sh|shell|curl|json)?[ \t]*\r?\n([\s\S]*?)```/gi)];
    const parts = blocks.map((match) => match[1].trim());
    const prose = text
      .replace(/```(?:bash|sh|shell|curl|json)?[ \t]*\r?\n[\s\S]*?```/gi, '')
      .trim();
    if (prose) parts.push(prose);

    for (const part of parts) {
      if (/^curl\s/.test(part)) {
        this.curl = part;
        this.readOnlyPost = false;
        this.awaitingPostConfirmation = false;
      } else if (/^[\[{]/.test(part)) {
        responseShape(part);
        this.sample = part;
      } else if (part === '确认只读 POST' && this.awaitingPostConfirmation) {
        this.readOnlyPost = true;
        this.awaitingPostConfirmation = false;
      } else {
        const combined = [this.goal, part].filter(Boolean).join('\n');
        if (combined.length > 4000) throw new Error('同步目标过长，请新建会话并简化目标');
        this.goal = combined;
      }
    }

    if (!this.goal)
      return { reply: '你希望这个流程完成什么任务？可以告诉我同步的字段和用来匹配记录的键。' };
    if (!this.curl) return { reply: '请贴一条源 API 的 cURL 请求。我会在本机提取请求头凭证。' };
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
      return { reply: '请贴一份脱敏的 JSON 响应。接口有分页时，可以补充下一页字段和停止规则。' };

    const result = await design({
      curl: this.curl,
      sample: this.sample,
      goal: this.goal,
      readOnlyPost: this.readOnlyPost,
    });
    return {
      reply: result.ready
        ? '只读试跑已通过。请核对草稿和预览，然后到 Dashboard 确认导出。'
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
