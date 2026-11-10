import type { GenuiWidget, ParseWidgetResult } from './types.ts';

function toNum(val: unknown, fallback: number): number {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    const parsed = Number.parseFloat(val);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function toStr(val: unknown, fallback = ''): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return fallback;
}

/**
 * w1 宽容层：
 * 1. 自动类型转换：数值字段如果是数字字符串自动转换为 number；
 * 2. 智能缺省填充：如 step 省略时自动按区间幅度推断，slider value 缺省为 min；
 * 3. 步长自动吸附：slider 初始值不在 step 整数倍时自动贴近最近合法步长，不报错；
 * 4. 冗余/未知字段宽容：忽略无关字段，不报错；
 * 5. 安全兜底：所有字符串依然保持纯文本渲染，不执行脚本。
 */
export function normalizeWidget(raw: Record<string, unknown>): ParseWidgetResult {
  const kind = raw.w;
  const warnings: string[] = [];

  switch (kind) {
    case 'slider': {
      let min = toNum(raw.min, 0);
      let max = toNum(raw.max, 100);
      if (min > max) {
        const tmp = min;
        min = max;
        max = tmp;
        warnings.push('min 大于 max，已自动调换');
      }

      let step = toNum(raw.step, 0);
      if (step <= 0) {
        const range = max - min;
        step = range <= 10 ? 0.5 : range <= 100 ? 1 : 5;
      }

      let value = toNum(raw.value ?? raw.initial, min);
      if (value < min) value = min;
      if (value > max) value = max;

      // 步长吸附
      const stepsCount = Math.round((value - min) / step);
      const snapped = Number((min + stepsCount * step).toFixed(6));
      if (snapped !== value) {
        value = snapped;
        warnings.push(`value 已自动吸附到步长合法值: ${value}`);
      }

      const widget: GenuiWidget = {
        w: 'slider',
        id: typeof raw.id === 'string' ? raw.id : undefined,
        label: typeof raw.label === 'string' ? raw.label : undefined,
        min,
        max,
        step,
        value,
        unit: typeof raw.unit === 'string' ? raw.unit : undefined,
      };
      return { ok: true, widget, warnings: warnings.length > 0 ? warnings : undefined };
    }

    case 'result': {
      let value: string | number;
      if (typeof raw.value === 'string' || typeof raw.value === 'number') {
        value = raw.value;
      } else {
        value = toStr(raw.value, '-');
      }
      const widget: GenuiWidget = {
        w: 'result',
        id: typeof raw.id === 'string' ? raw.id : undefined,
        label: typeof raw.label === 'string' ? raw.label : undefined,
        value,
        bind: typeof raw.bind === 'string' ? raw.bind : undefined,
        unit: typeof raw.unit === 'string' ? raw.unit : undefined,
        emphasis: raw.emphasis === 'primary' ? 'primary' : 'normal',
      };
      return { ok: true, widget };
    }

    case 'note': {
      const text = toStr(raw.text ?? raw.value, '');
      if (!text) {
        return { ok: false, code: 'schema-violation', detail: 'note 组件缺少 text 说明内容' };
      }
      const tone = (['info', 'warn', 'error'].includes(raw.tone as string))
        ? (raw.tone as 'info' | 'warn' | 'error')
        : 'info';

      const widget: GenuiWidget = {
        w: 'note',
        text,
        tone,
      };
      return { ok: true, widget };
    }

    case 'quiz': {
      const question = toStr(raw.question ?? raw.title, '');
      if (!question) {
        return { ok: false, code: 'schema-violation', detail: 'quiz 组件缺少 question 题目内容' };
      }
      const rawOptions = Array.isArray(raw.options) ? raw.options : [];
      const options = rawOptions.map((opt, i) => {
        if (typeof opt === 'string') {
          return { label: opt, value: String.fromCharCode(65 + i) }; // A, B, C...
        }
        if (typeof opt === 'object' && opt !== null) {
          const rec = opt as Record<string, unknown>;
          return {
            label: toStr(rec.label ?? rec.text, `选项 ${i + 1}`),
            value: toStr(rec.value ?? rec.id, String.fromCharCode(65 + i)),
          };
        }
        return { label: `选项 ${i + 1}`, value: String.fromCharCode(65 + i) };
      });

      const widget: GenuiWidget = {
        w: 'quiz',
        id: typeof raw.id === 'string' ? raw.id : undefined,
        question,
        options,
        answer: typeof raw.answer === 'string' ? raw.answer : undefined,
        explain: typeof raw.explain === 'string' ? raw.explain : undefined,
      };
      return { ok: true, widget };
    }

    case 'card': {
      const title = toStr(raw.title, '概要信息');
      const subtitle = typeof raw.subtitle === 'string' ? raw.subtitle : undefined;
      const points = Array.isArray(raw.points)
        ? raw.points.map((p) => toStr(p)).filter(Boolean)
        : undefined;
      const tags = Array.isArray(raw.tags)
        ? raw.tags.map((t) => toStr(t)).filter(Boolean)
        : undefined;

      const widget: GenuiWidget = {
        w: 'card',
        title,
        subtitle,
        points,
        tags,
      };
      return { ok: true, widget };
    }

    case 'compare': {
      const title = typeof raw.title === 'string' ? raw.title : undefined;
      const rawItems = Array.isArray(raw.items) ? raw.items : [];
      const items = rawItems.map((item, idx) => {
        if (typeof item === 'object' && item !== null) {
          const rec = item as Record<string, unknown>;
          return {
            name: toStr(rec.name ?? rec.label ?? rec.title, `方案 ${idx + 1}`),
            pros: Array.isArray(rec.pros) ? rec.pros.map((p) => toStr(p)) : undefined,
            cons: Array.isArray(rec.cons) ? rec.cons.map((c) => toStr(c)) : undefined,
            fields: (typeof rec.fields === 'object' && rec.fields !== null)
              ? (rec.fields as Record<string, string | number>)
              : undefined,
          };
        }
        return { name: `方案 ${idx + 1}` };
      });

      const widget: GenuiWidget = {
        w: 'compare',
        title,
        items,
        highlight: typeof raw.highlight === 'string' ? raw.highlight : undefined,
      };
      return { ok: true, widget };
    }

    case 'checklist': {
      const title = typeof raw.title === 'string' ? raw.title : undefined;
      const rawItems = Array.isArray(raw.items) ? raw.items : [];
      const items = rawItems.map((item, idx) => {
        if (typeof item === 'string') {
          return { text: item, checked: false };
        }
        if (typeof item === 'object' && item !== null) {
          const rec = item as Record<string, unknown>;
          return {
            text: toStr(rec.text ?? rec.label, `步骤 ${idx + 1}`),
            note: typeof rec.note === 'string' ? rec.note : undefined,
            checked: Boolean(rec.checked),
          };
        }
        return { text: `步骤 ${idx + 1}`, checked: false };
      });

      const widget: GenuiWidget = {
        w: 'checklist',
        title,
        items,
      };
      return { ok: true, widget };
    }

    case 'timeline': {
      const title = typeof raw.title === 'string' ? raw.title : undefined;
      const rawItems = Array.isArray(raw.items) ? raw.items : [];
      if (rawItems.length === 0) {
        return { ok: false, code: 'schema-violation', detail: 'timeline 组件至少需要 1 个节点' };
      }
      const items = rawItems.map((item, idx) => {
        if (typeof item === 'string') {
          return { time: `Step ${idx + 1}`, title: item };
        }
        if (typeof item === 'object' && item !== null) {
          const rec = item as Record<string, unknown>;
          const timeText = toStr(rec.time ?? rec.date ?? rec.step, `Step ${idx + 1}`).trim();
          return {
            time: timeText === '' ? `Step ${idx + 1}` : timeText,
            title: toStr(rec.title ?? rec.name ?? rec.label, `节点 ${idx + 1}`),
            desc: typeof rec.desc === 'string'
              ? rec.desc
              : typeof rec.description === 'string'
                ? rec.description
                : undefined,
            highlight: rec.highlight === true ? true : undefined,
          };
        }
        return { time: `Step ${idx + 1}`, title: `节点 ${idx + 1}` };
      });

      const widget: GenuiWidget = {
        w: 'timeline',
        title,
        items,
      };
      return { ok: true, widget };
    }

    case 'spoiler': {
      const content = toStr(raw.content ?? raw.text ?? raw.value, '').trim();
      if (!content) {
        return { ok: false, code: 'schema-violation', detail: 'spoiler 组件缺少 content 内容' };
      }
      const summary = toStr(raw.summary ?? raw.title, '').trim() || '点击查看推导细节';
      const hint = typeof raw.hint === 'string' && raw.hint.trim() !== '' ? raw.hint : undefined;

      const widget: GenuiWidget = {
        w: 'spoiler',
        summary,
        hint,
        content,
      };
      return { ok: true, widget };
    }

    case 'poll': {
      const question = toStr(raw.question ?? raw.title, '').trim();
      if (!question) {
        return { ok: false, code: 'schema-violation', detail: 'poll 组件缺少 question 问题内容' };
      }
      const rawOptions = Array.isArray(raw.options) ? raw.options : [];
      if (rawOptions.length === 0) {
        return { ok: false, code: 'schema-violation', detail: 'poll 组件至少需要 1 个选项' };
      }

      const extracted = rawOptions.map((item, idx) => {
        if (typeof item === 'string') {
          return { id: `opt_${idx + 1}`, label: item, ratio: Number.NaN };
        }
        if (typeof item === 'object' && item !== null) {
          const rec = item as Record<string, unknown>;
          return {
            id: toStr(rec.id ?? rec.value, `opt_${idx + 1}`),
            label: toStr(rec.label ?? rec.text ?? rec.name, `选项 ${idx + 1}`),
            ratio: toNum(rec.ratio, Number.NaN),
          };
        }
        return { id: `opt_${idx + 1}`, label: `选项 ${idx + 1}`, ratio: Number.NaN };
      });

      // 比例宽容补全：全部提供合法非负值且总和大于 0 时保留（取整并夹取），否则按数量均分且总和恰为 100。
      const allRatiosValid = extracted.every((o) => Number.isFinite(o.ratio) && o.ratio >= 0);
      const ratioSum = extracted.reduce((acc, o) => acc + (Number.isFinite(o.ratio) ? o.ratio : 0), 0);
      let options;
      if (allRatiosValid && ratioSum > 0) {
        options = extracted.map((o) => ({
          id: o.id,
          label: o.label,
          ratio: Math.min(100, Math.max(0, Math.round(o.ratio))),
        }));
      } else {
        const base = Math.floor(100 / extracted.length);
        const remainder = 100 - base * extracted.length;
        options = extracted.map((o, idx) => ({
          id: o.id,
          label: o.label,
          ratio: base + (idx < remainder ? 1 : 0),
        }));
      }

      const widget: GenuiWidget = {
        w: 'poll',
        question,
        options,
      };
      return { ok: true, widget };
    }

    default:
      return {
        ok: false,
        code: 'schema-violation',
        detail: `未知的内联组件类型: ${String(kind)}`,
      };
  }
}
