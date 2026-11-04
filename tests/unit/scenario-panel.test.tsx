import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScenarioPanel } from '../../src/render/scenario-panel';
import {
  createScenarioPort,
  createScenarioStore,
  SCENARIO_KEY_PREFIX,
  type ScenarioStorageArea,
} from '../../src/content/scenario-store';
import type { GenuiV3Document, InteractiveStateValues } from '../../src/protocol/types';
import { documentStateSignature, type TableViewState } from '../../src/runtime/card-state';
import type { SavedScenario } from '../../src/runtime/scenario';

/**
 * issue #6：方案工作台 UI 流程。
 *
 * 覆盖验收：保存 A 后调 B 不覆盖、并排比较与不兼容说明、
 * 导出再导入恢复身份、旧/损坏/超大/不支持版本反馈、
 * 删除与清除实际移除本机内容、差异交给「继续讨论」。
 */

class FakeArea implements ScenarioStorageArea {
  readonly items = new Map<string, unknown>();

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) return Object.fromEntries(this.items);
    const list = typeof keys === 'string' ? [keys] : keys;
    const result: Record<string, unknown> = {};
    for (const key of list) {
      if (this.items.has(key)) result[key] = this.items.get(key);
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.items.set(key, value);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === 'string' ? [keys] : keys) this.items.delete(key);
  }
}

const DOC: GenuiV3Document = {
  type: 'genui',
  version: 3,
  title: '预算规划',
  state: [
    { id: 'budget', label: '预算', kind: 'number', initial: 5000, min: 0, max: 100000, step: 100, unit: '元' },
    {
      id: 'tier',
      label: '档位',
      kind: 'select',
      initial: 'standard',
      options: [
        { label: '标准', value: 'standard' },
        { label: '豪华', value: 'luxury' },
      ],
    },
  ],
  derived: [
    { id: 'total', label: '合计', expression: { op: 'add', left: { op: 'state', id: 'budget' }, right: { op: 'const', value: 0 } } },
  ],
  elements: [{ kind: 'slider', bind: 'budget' }],
};

const activeCleanup: Array<() => void> = [];

function setup(options: {
  now?: () => number;
  seed?: (area: FakeArea) => void;
  onApply?: (values: InteractiveStateValues, tables: Record<string, TableViewState>) => void;
} = {}) {
  const area = new FakeArea();
  options.seed?.(area);
  const store = createScenarioStore(area);
  const port = createScenarioPort({
    store,
    document: DOC,
    documentHash: 'doc-hash',
    source: { sessionId: '/a/chat/s/session', messageKey: 'vl:1', duplicateIndex: 0, title: '预算规划' },
    now: options.now ?? (() => 1000),
  });
  const onContinue = vi.fn<(summary: string) => 'filled'>(() => 'filled' as const);
  const utils = render(
    <ScenarioPanel
      document={DOC}
      port={port}
      values={{ budget: 5000, tier: 'standard' }}
      tables={{}}
      results={{ values: { total: 5000 }, errors: {} }}
      onContinue={onContinue}
      onApply={options.onApply}
    />,
  );
  // 本环境未开 vitest globals，testing-library 无法自动清理，手动卸载。
  activeCleanup.push(utils.unmount);
  return { area, port, onContinue, ...utils };
}

function scenarioKeys(area: FakeArea): string[] {
  return [...area.items.keys()].filter((key) => key.startsWith(SCENARIO_KEY_PREFIX));
}

function statusText(): string {
  return screen.getAllByRole('status').map((node) => node.textContent ?? '').join(' | ');
}

afterEach(() => {
  for (const cleanup of activeCleanup.splice(0)) cleanup();
  vi.useRealTimers();
});

describe('保存具名方案：A 不被后续调整覆盖', () => {
  it('保存 A 后改参数保存 B，两份方案各自保留当时的输入与结果', async () => {
    const { rerender, area } = setup();

    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '方案 A' } });
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    await waitFor(() => expect(statusText()).toContain('已保存方案「方案 A」'));

    rerender(
      <ScenarioPanel
        document={DOC}
        port={createScenarioPort({
          store: createScenarioStore(area),
          document: DOC,
          documentHash: 'doc-hash',
          source: { sessionId: '/a/chat/s/session', messageKey: 'vl:1', duplicateIndex: 0, title: '预算规划' },
          now: () => 2000,
        })}
        values={{ budget: 8000, tier: 'luxury' }}
        tables={{}}
        results={{ values: { total: 8000 }, errors: {} }}
      />,
    );

    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '方案 B' } });
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    await waitFor(() => expect(statusText()).toContain('已保存方案「方案 B」'));

    expect(scenarioKeys(area)).toHaveLength(2);
    const stored = [...area.items.values()] as SavedScenario[];
    const a = stored.find((item) => item.name === '方案 A');
    const b = stored.find((item) => item.name === '方案 B');
    expect(a?.values).toEqual({ budget: 5000, tier: 'standard' });
    expect(a?.results.values).toEqual({ total: 5000 });
    expect(b?.values).toEqual({ budget: 8000, tier: 'luxury' });
    expect(b?.results.values).toEqual({ total: 8000 });
    // 名称为空时拒绝保存。
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    expect(scenarioKeys(area)).toHaveLength(2);
  });
});

describe('并排比较', () => {
  it('两份兼容方案显示逐项差异与变化标记', async () => {
    const { rerender, area } = setup();
    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '保守方案' } });
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    await waitFor(() => expect(statusText()).toContain('已保存'));

    rerender(
      <ScenarioPanel
        document={DOC}
        port={createScenarioPort({
          store: createScenarioStore(area),
          document: DOC,
          documentHash: 'doc-hash',
          source: { sessionId: '/a/chat/s/session', messageKey: 'vl:1', duplicateIndex: 0, title: '预算规划' },
          now: () => 2000,
        })}
        values={{ budget: 9000, tier: 'luxury' }}
        tables={{}}
        results={{ values: { total: 9000 }, errors: {} }}
      />,
    );
    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '激进方案' } });
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    await waitFor(() => expect(statusText()).toContain('已保存'));

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    const compareButton = screen.getByRole('button', { name: '并排比较（勾选 2 项）' });
    expect(compareButton).not.toBeDisabled();
    fireEvent.click(compareButton);

    const table = screen.getByRole('table');
    expect(table.textContent).toContain('保守方案');
    expect(table.textContent).toContain('激进方案');
    // 参数与结果都有差异行，且标注变化。
    expect(table.querySelector('.genui-scenario-row-changed')).not.toBeNull();
    expect(table.textContent).toContain('5000');
    expect(table.textContent).toContain('9000');
  });

  it('只勾选一项时无法比较', async () => {
    const { area } = setup();
    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '方案 A' } });
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    await waitFor(() => expect(scenarioKeys(area)).toHaveLength(1));
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(screen.getByRole('button', { name: '并排比较（勾选 2 项）' })).toBeDisabled();
  });
});

describe('导入校验', () => {
  it('旧格式、损坏文件、超大文件与不支持版本都有明确反馈', async () => {
    const { port } = setup();

    expect((await port.importText('{"genui":1}')).message).toContain('缺少方案格式标记');
    expect((await port.importText('{broken')).message).toContain('不是有效的 JSON');
    expect((await port.importText(JSON.stringify({ format: 'genui-scenario', version: 99 }))).message).toContain(
      '高于当前支持的版本',
    );
    expect((await port.importText(JSON.stringify({ format: 'genui-scenario', version: 1 }))).message).toContain(
      '字段缺失或无效',
    );
    expect((await port.importText('x'.repeat(65 * 1024))).message).toContain('文件过大');
  });

  it('导入不覆盖已有方案，并恢复参数与方案身份', async () => {
    const { area, port } = setup();
    const original: SavedScenario = {
      format: 'genui-scenario',
      version: 1,
      id: 'scn_fixed',
      name: '基准方案',
      savedAt: 1234,
      documentHash: 'doc-hash',
      stateSignature: documentStateSignature(DOC),
      protocolVersion: 3,
      ruleVersion: 1,
      source: { sessionId: '/a/chat/s/session', messageKey: 'vl:1', duplicateIndex: 0, title: '预算规划' },
      values: { budget: 4200, tier: 'standard' },
      tables: {},
      results: { values: { total: 4200 }, errors: {} },
    };

    const first = await port.importText(JSON.stringify(original));
    expect(first.ok).toBe(true);
    const stored = area.items.get(`${SCENARIO_KEY_PREFIX}scn_fixed`) as SavedScenario;
    expect(stored.values).toEqual({ budget: 4200, tier: 'standard' });
    expect(stored.id).toBe('scn_fixed');
    expect(stored.savedAt).toBe(1234);

    // 再次导入同 id：不覆盖。
    const tampered: SavedScenario = { ...original, values: { budget: 99999, tier: 'luxury' } };
    const second = await port.importText(JSON.stringify(tampered));
    expect(second.ok).toBe(true);
    expect(second.message).toContain('未覆盖');
    const after = area.items.get(`${SCENARIO_KEY_PREFIX}scn_fixed`) as SavedScenario;
    expect(after.values).toEqual({ budget: 4200, tier: 'standard' });

    // 界面不同的方案：明确拒绝。
    const foreign: SavedScenario = { ...original, id: 'scn_other', documentHash: 'other-hash' };
    const third = await port.importText(JSON.stringify(foreign));
    expect(third.ok).toBe(false);
    expect(third.message).toContain('文档哈希不同');
  });
});

describe('删除与清除', () => {
  it('删除与清除实际移除本机保存内容', async () => {
    const { rerender, area } = setup();
    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '临时方案' } });
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    await waitFor(() => expect(scenarioKeys(area)).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(scenarioKeys(area)).toHaveLength(0));

    // 再保存两条后整体清除。
    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '方案一' } });
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    await waitFor(() => expect(scenarioKeys(area)).toHaveLength(1));
    rerender(
      <ScenarioPanel
        document={DOC}
        port={createScenarioPort({
          store: createScenarioStore(area),
          document: DOC,
          documentHash: 'doc-hash',
          source: { sessionId: '/a/chat/s/session', messageKey: 'vl:1', duplicateIndex: 0, title: '预算规划' },
          now: () => 3000,
        })}
        values={{ budget: 6000, tier: 'standard' }}
        tables={{}}
        results={{ values: { total: 6000 }, errors: {} }}
      />,
    );
    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '方案二' } });
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    await waitFor(() => expect(scenarioKeys(area)).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: '清除全部方案' }));
    await waitFor(() => expect(scenarioKeys(area)).toHaveLength(0));
    expect(statusText()).toContain('已清除本机保存的 2 条方案');
  });
});

describe('继续讨论交接', () => {
  it('单方案与两方案差异都能交给继续讨论', async () => {
    const { rerender, area, onContinue } = setup();
    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '方案 A' } });
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    await waitFor(() => expect(scenarioKeys(area)).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: '继续讨论此方案' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    const summary = onContinue.mock.calls[0]![0];
    expect(summary).toContain('方案「方案 A」');
    expect(summary).toContain('请基于以上保存的方案继续讨论。');
    expect(statusText()).toContain('已填入输入框');

    rerender(
      <ScenarioPanel
        document={DOC}
        port={createScenarioPort({
          store: createScenarioStore(area),
          document: DOC,
          documentHash: 'doc-hash',
          source: { sessionId: '/a/chat/s/session', messageKey: 'vl:1', duplicateIndex: 0, title: '预算规划' },
          now: () => 2000,
        })}
        values={{ budget: 7000, tier: 'luxury' }}
        tables={{}}
        results={{ values: { total: 7000 }, errors: {} }}
        onContinue={onContinue}
      />,
    );
    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '方案 B' } });
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    await waitFor(() => expect(scenarioKeys(area)).toHaveLength(2));

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    fireEvent.click(screen.getByRole('button', { name: '差异交给继续讨论' }));
    expect(onContinue).toHaveBeenCalledTimes(2);
    const diffSummary = onContinue.mock.calls[1]![0];
    expect(diffSummary).toContain('方案对比');
    expect(diffSummary).toContain('请基于以上方案差异继续讨论。');
  });
});

/** 直接写入本机的方案记录（模拟其他卡片保存的方案）。 */
function seedScenario(area: FakeArea, overrides: Partial<SavedScenario>): SavedScenario {
  const record: SavedScenario = {
    format: 'genui-scenario',
    version: 1,
    id: 'scn_seed',
    name: '他卡方案',
    savedAt: 500,
    documentHash: 'other-hash',
    stateSignature: documentStateSignature(DOC),
    protocolVersion: 3,
    ruleVersion: 1,
    source: { sessionId: '/a/chat/s/session', messageKey: 'vl:2', duplicateIndex: 0, title: '其他卡片' },
    values: { budget: 3000, tier: 'standard' },
    tables: {},
    results: { values: { total: 3000 }, errors: {} },
    ...overrides,
  };
  area.items.set(`${SCENARIO_KEY_PREFIX}${record.id}`, record);
  return record;
}

describe('跨卡片摘要守卫（P1-1）', () => {
  it('其他界面的方案不能导出摘要或交给继续讨论', async () => {
    const { onContinue } = setup({ seed: (area) => seedScenario(area, {}) });
    await waitFor(() => expect(screen.getByText('他卡方案')).toBeTruthy());

    // 导出摘要被拦截并说明原因。
    fireEvent.click(screen.getByRole('button', { name: '导出摘要' }));
    expect(statusText()).toContain('文档哈希不同');
    expect(statusText()).toContain('无法用当前卡片字段解释');

    // 继续讨论被拦截，摘要不进入聊天。
    fireEvent.click(screen.getByRole('button', { name: '继续讨论此方案' }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(statusText()).toContain('无法用当前卡片字段解释');

    // 应用入口同样禁用。
    expect(screen.getByRole('button', { name: '应用此方案' })).toBeDisabled();
  });

  it('本界面的方案摘要与应用入口可用', async () => {
    const onApply = vi.fn();
    const { onContinue } = setup({
      seed: (area) => seedScenario(area, { documentHash: 'doc-hash' }),
      onApply,
    });
    await waitFor(() => expect(screen.getByText('他卡方案')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '继续讨论此方案' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue.mock.calls[0]![0]).toContain('方案「他卡方案」');
    expect(screen.getByRole('button', { name: '应用此方案' })).not.toBeDisabled();
  });
});

describe('应用已保存方案（P2-3）', () => {
  it('点击应用把方案参数与表格视图交给卡片', async () => {
    const onApply = vi.fn();
    const { area } = setup({ onApply });
    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '方案 A' } });
    fireEvent.click(screen.getByRole('button', { name: '保存当前方案' }));
    await waitFor(() => expect(scenarioKeys(area)).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: '应用此方案' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0]).toEqual({ budget: 5000, tier: 'standard' });
    expect(onApply.mock.calls[0]![1]).toEqual({});
    expect(statusText()).toContain('已应用方案「方案 A」');
  });
});

describe('CSV 导出入口（P2-4）', () => {
  it('没有表格数据时给出明确反馈', async () => {
    const { area } = setup();
    fireEvent.click(screen.getByRole('button', { name: '导出表格 CSV' }));
    expect(statusText()).toContain('当前界面没有可导出的表格数据。');
    expect(scenarioKeys(area)).toHaveLength(0);
  });
});

describe('重算差异展示（P2-5）', () => {
  it('保存值与重算值不一致时展开逐项对照', async () => {
    setup({
      seed: (area) =>
        seedScenario(area, {
          documentHash: 'doc-hash',
          values: { budget: 4000, tier: 'standard' },
          results: { values: { total: 999 }, errors: {} },
        }),
    });
    await waitFor(() => expect(screen.getByText('他卡方案')).toBeTruthy());

    const details = screen.getByText('保存时结果 vs 当前规则重算');
    const container = details.closest('details');
    expect(container).not.toBeNull();
    expect(container?.textContent).toContain('total：保存 999 → 当前 4000');
    expect(screen.getByText('按当前规则重算与保存时不一致')).toBeTruthy();
  });

  it('规则版本变化但数值一致也给出提示', async () => {
    setup({ seed: (area) => seedScenario(area, { documentHash: 'doc-hash', ruleVersion: 99 }) });
    await waitFor(() => expect(screen.getByText('他卡方案')).toBeTruthy());

    expect(screen.getByText('计算规则版本已变化，重算结果一致')).toBeTruthy();
    const details = screen.getByText('保存时结果 vs 当前规则重算').closest('details');
    expect(details?.textContent).toContain('计算规则版本：保存时 v99');
  });
});
