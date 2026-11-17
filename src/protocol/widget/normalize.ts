import { validateFormPromptTemplate } from './template.ts';
import type {
  FormField,
  FormOption,
  GenuiWidget,
  ParseWidgetResult,
  QuizOption,
  QuizQuestionItem,
} from './types.ts';

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

function normalizeQuizOptions(rawOptions: unknown[]): QuizOption[] {
  return rawOptions.map((opt, i) => {
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
}

function normalizeFormOptions(rawOptions: unknown[]): FormOption[] {
  const out: FormOption[] = [];
  rawOptions.forEach((opt, idx) => {
    if (typeof opt === 'string') {
      const trimmed = opt.trim();
      if (trimmed) out.push({ label: trimmed, value: trimmed });
      return;
    }
    if (typeof opt === 'object' && opt !== null) {
      const rec = opt as Record<string, unknown>;
      const labelRaw = toStr(rec.label ?? rec.text ?? rec.name, '').trim();
      const valueRaw = toStr(rec.value ?? rec.id, '').trim();
      const label = labelRaw || valueRaw || `选项 ${idx + 1}`;
      const value = valueRaw || labelRaw || `opt_${idx + 1}`;
      out.push({ label, value });
    }
  });
  return out;
}

function resolveOptionValue(options: readonly FormOption[], rawValue: unknown): string | undefined {
  if (typeof rawValue !== 'string') return undefined;
  const target = rawValue.trim();
  if (!target) return undefined;
  const found = options.find((opt) => opt.value === target || opt.label === target);
  return found?.value;
}

function normalizeFormFieldType(rawType: unknown): 'radio' | 'choice' | 'checkbox' | 'text' | null {
  if (rawType === 'radio' || rawType === 'single' || rawType === 'select') return 'radio';
  if (rawType === 'choice') return 'choice';
  if (rawType === 'checkbox' || rawType === 'multi' || rawType === 'multiselect') return 'checkbox';
  if (rawType === 'text' || rawType === 'textarea' || rawType === 'input') return 'text';
  return null;
}

function toOptionalPositiveInt(val: unknown): number | undefined {
  if (typeof val !== 'number' || !Number.isFinite(val)) return undefined;
  const rounded = Math.floor(val);
  return rounded > 0 ? rounded : undefined;
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
      const grade = raw.grade === 'model' ? 'model' : 'local';
      const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];
      const questions: QuizQuestionItem[] = [];
      for (const [idx, item] of rawQuestions.entries()) {
        if (typeof item !== 'object' || item === null) continue;
        const rec = item as Record<string, unknown>;
        const qText = toStr(rec.question ?? rec.title ?? rec.label, '').trim();
        const opts = normalizeQuizOptions(Array.isArray(rec.options) ? rec.options : []);
        if (!qText || opts.length === 0) continue;
        questions.push({
          id: typeof rec.id === 'string' && rec.id.trim() !== '' ? rec.id.trim() : `q${idx + 1}`,
          question: qText,
          options: opts,
        });
      }

      const rawOptions = Array.isArray(raw.options) ? raw.options : [];
      const topOptions = normalizeQuizOptions(rawOptions);
      const question = toStr(raw.question ?? raw.title, '').trim() || questions[0]?.question || '';
      const options = topOptions.length > 0 ? topOptions : (questions[0]?.options ?? []);

      if (!question) {
        return { ok: false, code: 'schema-violation', detail: 'quiz 组件缺少 question 题目内容' };
      }

      if (grade === 'model') {
        if (raw.answer !== undefined || raw.explain !== undefined) {
          warnings.push('grade:"model" 模式下已忽略本地 answer/explain，避免泄露答案');
        }
        const reason = raw.reason !== false;
        const reasonLabel =
          typeof raw.reason === 'string' && raw.reason.trim() !== ''
            ? raw.reason.trim()
            : toStr(raw.reasonLabel, '').trim() || '简要解释理由（选填）';

        const rawSubmit =
          typeof raw.submit === 'object' && raw.submit !== null
            ? (raw.submit as Record<string, unknown>)
            : {};
        const submitLabel = toStr(rawSubmit.label, '').trim() || '提交答案并批改';
        const rawPrompt = toStr(rawSubmit.prompt, '');
        const validIds = new Set(
          (questions.length > 0 ? questions : [{ id: 'q1' }]).map(
            (q, i) => q.id ?? `q${i + 1}`,
          ),
        );
        if (reason) validIds.add('reason');
        let submitPrompt = '';
        if (rawPrompt.trim() !== '') {
          const check = validateFormPromptTemplate(rawPrompt, validIds);
          if (check.valid) {
            submitPrompt = rawPrompt;
          } else {
            warnings.push('quiz submit.prompt 引用了无效字段，已回退默认批改模板');
          }
        }

        const widget: GenuiWidget = {
          w: 'quiz',
          id: typeof raw.id === 'string' ? raw.id : undefined,
          question,
          options,
          grade: 'model',
          ...(questions.length > 0 ? { questions } : {}),
          reason,
          reasonLabel,
          submit: {
            label: submitLabel,
            ...(submitPrompt ? { prompt: submitPrompt } : {}),
          },
        };
        return {
          ok: true,
          widget,
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      }

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

    case 'form': {
      const rawTitle = toStr(raw.title ?? raw.question, '').trim();
      if (!rawTitle) {
        warnings.push('form 缺少 title，已使用默认标题');
      }
      const title = rawTitle || '请确认以下信息';
      const subtitle =
        typeof raw.subtitle === 'string' && raw.subtitle.trim() !== ''
          ? raw.subtitle.trim()
          : undefined;
      const rawFields = Array.isArray(raw.fields) ? raw.fields : [];
      if (rawFields.length === 0) {
        return { ok: false, code: 'schema-violation', detail: 'form 组件至少需要 1 个字段' };
      }

      const parsedTypes = rawFields.map((item) =>
        typeof item === 'object' && item !== null
          ? normalizeFormFieldType((item as Record<string, unknown>).type)
          : null,
      );
      const isQuizIntent = raw.intent === 'quiz' || parsedTypes.some((t) => t === 'choice');
      const intent: 'clarify' | 'quiz' = isQuizIntent ? 'quiz' : 'clarify';

      const usedIds = new Set<string>();
      const fields: FormField[] = [];
      for (const [idx, item] of rawFields.entries()) {
        if (typeof item !== 'object' || item === null) {
          warnings.push(`form 第 ${idx + 1} 个字段格式无效，已忽略`);
          continue;
        }
        const rec = item as Record<string, unknown>;
        const fieldType = normalizeFormFieldType(rec.type);
        if (!fieldType) {
          warnings.push(`form 第 ${idx + 1} 个字段类型不支持，已忽略`);
          continue;
        }

        let id = toStr(rec.id, '').trim() || `field_${idx + 1}`;
        if (usedIds.has(id)) {
          const uniqueId = `${id}_${idx + 1}`;
          warnings.push(`form 字段 id 重复（${id}），已调整为 ${uniqueId}`);
          id = uniqueId;
        }
        usedIds.add(id);

        const label =
          toStr(rec.label ?? rec.title ?? rec.question, '').trim() || `选项 ${idx + 1}`;

        if (fieldType === 'text') {
          const optional =
            rec.optional === true ||
            rec.required === false ||
            /选填|可选|optional/i.test(label);
          let defaultText: string | undefined;
          if (!isQuizIntent && typeof rec.default === 'string' && rec.default !== '') {
            defaultText = rec.default;
          } else if (isQuizIntent && rec.default !== undefined) {
            warnings.push(`测验/评估类字段 ${id} 已清除预选默认值`);
          }
          fields.push({
            id,
            type: 'text',
            label,
            placeholder:
              typeof rec.placeholder === 'string' && rec.placeholder.trim() !== ''
                ? rec.placeholder.trim()
                : undefined,
            default: defaultText,
            optional,
            maxLength: toOptionalPositiveInt(rec.maxLength),
          });
          continue;
        }

        const options = normalizeFormOptions(Array.isArray(rec.options) ? rec.options : []);
        if (options.length === 0) {
          warnings.push(`form 字段 ${id} 缺少有效选项，已忽略`);
          continue;
        }
        const layout = rec.layout === 'inline' ? 'inline' : 'vertical';
        const optional = rec.optional === true || rec.required === false;

        if (fieldType === 'checkbox') {
          let defaultValues: string[] | undefined;
          if (isQuizIntent) {
            if (rec.default !== undefined) {
              warnings.push(`测验/评估类字段 ${id} 已清除预选默认值`);
            }
          } else if (Array.isArray(rec.default)) {
            const resolved = rec.default
              .map((entry) => resolveOptionValue(options, entry))
              .filter((val): val is string => val !== undefined);
            if (resolved.length > 0) {
              defaultValues = [...new Set(resolved)];
            }
          }
          fields.push({
            id,
            type: 'checkbox',
            label,
            options,
            default: defaultValues,
            layout,
            optional,
          });
          continue;
        }

        let defaultSingle: string | undefined;
        if (isQuizIntent || fieldType === 'choice') {
          if (rec.default !== undefined) {
            warnings.push(`测验/评估类字段 ${id} 已清除预选默认值`);
          }
        } else if (rec.default !== undefined) {
          defaultSingle = resolveOptionValue(options, rec.default);
          if (!defaultSingle) {
            warnings.push(`form 字段 ${id} 的默认值未命中任何选项，已忽略`);
          }
        }
        fields.push({
          id,
          type: fieldType,
          label,
          options,
          default: defaultSingle,
          layout,
          optional,
        });
      }

      if (fields.length === 0) {
        return { ok: false, code: 'schema-violation', detail: 'form 组件缺少有效字段' };
      }

      const rawSubmit =
        typeof raw.submit === 'object' && raw.submit !== null
          ? (raw.submit as Record<string, unknown>)
          : {};
      const submitLabel =
        toStr(rawSubmit.label, '').trim() || (isQuizIntent ? '提交答案并批改' : '提交并继续');
      const rawPrompt = toStr(rawSubmit.prompt, '');
      const fieldIdSet = new Set(fields.map((field) => field.id));
      const templateCheck = validateFormPromptTemplate(rawPrompt, fieldIdSet);
      let prompt = '';
      if (templateCheck.valid) {
        prompt = rawPrompt;
      } else {
        if (templateCheck.reason === 'empty') {
          warnings.push('form 缺少 submit.prompt，已回退本地通用模板');
        } else if (templateCheck.reason === 'syntax') {
          warnings.push('form submit.prompt 占位符语法不合法，已回退本地通用模板');
        } else {
          warnings.push(
            `form submit.prompt 引用了不存在的字段（${templateCheck.missingFields.join(', ')}），已回退本地通用模板`,
          );
        }
      }

      const widget: GenuiWidget = {
        w: 'form',
        id: typeof raw.id === 'string' ? raw.id : undefined,
        title,
        subtitle,
        intent,
        fields,
        submit: {
          label: submitLabel,
          prompt,
        },
      };
      return {
        ok: true,
        widget,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    default:
      return {
        ok: false,
        code: 'schema-violation',
        detail: `未知的内联组件类型: ${String(kind)}`,
      };
  }
}
