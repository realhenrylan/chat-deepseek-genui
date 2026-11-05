import { describe, expect, it } from 'vitest';
import {
  createDiagnosticRecorder,
  DIAGNOSTICS_SCHEMA,
  summarizeDiagnostics,
  type DiagnosticsContext,
} from '../../src/runtime/diagnostics';

const CONTEXT: DiagnosticsContext = {
  extensionVersion: '0.1.1',
  adapter: {
    id: 'deepseek-chat',
    version: '2026-11-02',
    probe: { assistantContainers: 1, inputFound: true },
  },
  page: { route: 'chat', candidates: 1, mounted: 0, failed: 1 },
};

function recorderWithClock(start = 0, step = 0) {
  let now = start;
  const recorder = createDiagnosticRecorder({
    cooldownMs: 100,
    now: () => {
      const value = now;
      now += step;
      return value;
    },
  });
  return {
    recorder,
    advance: (ms: number) => {
      now += ms;
    },
    set: (value: number) => {
      now = value;
    },
  };
}

describe('脱敏本地诊断', () => {
  it('同类同代码合并为一条，计数按冷却窗口节流', () => {
    const { recorder, set } = recorderWithClock();
    set(0);
    recorder.record('detection', 'missing-pre', 0);
    recorder.record('detection', 'missing-pre', 10);
    // 冷却窗口内只更新时间，不增加计数。
    recorder.record('detection', 'missing-pre', 110);

    const snapshot = recorder.snapshot(CONTEXT, 120);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({
      category: 'detection',
      code: 'missing-pre',
      count: 2,
    });
    expect(snapshot.entries[0].firstAt).toBe(new Date(0).toISOString());
    expect(snapshot.entries[0].lastAt).toBe(new Date(110).toISOString());
  });

  it('识别、等待、协议、挂载四类分开记录', () => {
    const recorder = createDiagnosticRecorder({ now: () => 0 });
    recorder.record('detection', 'no-input');
    recorder.record('waiting', 'streaming');
    recorder.record('protocol', 'invalid-json');
    recorder.record('mount', 'mount-failed');

    const snapshot = recorder.snapshot(CONTEXT, 0);
    expect(snapshot.entries.map((entry) => `${entry.category}/${entry.code}`)).toEqual([
      'detection/no-input',
      'waiting/streaming',
      'protocol/invalid-json',
      'mount/mount-failed',
    ]);
  });

  it('拒绝固定词表之外的代码，避免任意文本进入导出', () => {
    const recorder = createDiagnosticRecorder();
    expect(() => recorder.record('mount', 'invalid-json' as never)).toThrow(
      '未知诊断代码: mount/invalid-json',
    );
    expect(() => recorder.record('other' as never, 'x' as never)).toThrow(/未知诊断代码/);
    expect(recorder.size).toBe(0);
  });

  it('超过条目上限时淘汰最早记录并置 truncated', () => {
    const recorder = createDiagnosticRecorder({ limit: 1, now: () => 0 });
    recorder.record('detection', 'no-input', 0);
    recorder.record('protocol', 'invalid-json', 1);

    const snapshot = recorder.snapshot(CONTEXT, 2);
    expect(recorder.size).toBe(1);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.entries.map((entry) => entry.code)).toEqual(['invalid-json']);
  });

  it('探针只复制数量/布尔值，字符串字段被丢弃', () => {
    const recorder = createDiagnosticRecorder({ now: () => 0 });
    const polluted = {
      assistantContainers: 2,
      inputFound: false,
      leakedChatText: '用户机密草稿',
    } as never;
    const snapshot = recorder.snapshot(
      { ...CONTEXT, adapter: { ...CONTEXT.adapter, probe: polluted } },
      0,
    );

    expect(snapshot.adapter.probe).toEqual({ assistantContainers: 2, inputFound: false });
    expect(JSON.stringify(snapshot)).not.toContain('用户机密草稿');
  });

  it('导出结构固定且不含自由文本字段', () => {
    const recorder = createDiagnosticRecorder({ now: () => 0 });
    recorder.record('protocol', 'invalid-json', 0);
    const snapshot = recorder.snapshot(CONTEXT, 5);

    expect(snapshot.schema).toBe(DIAGNOSTICS_SCHEMA);
    expect(snapshot.generatedAt).toBe(new Date(5).toISOString());
    expect(snapshot.extension).toEqual({ version: '0.1.1' });
    expect(snapshot.adapter.id).toBe('deepseek-chat');
    expect(snapshot.page).toEqual(CONTEXT.page);
    expect(snapshot.entries[0]).toEqual({
      category: 'protocol',
      code: 'invalid-json',
      count: 1,
      firstAt: new Date(0).toISOString(),
      lastAt: new Date(0).toISOString(),
    });
    // 没有 detail/message/path 之类可夹带聊天内容的字段。
    expect(Object.keys(snapshot.entries[0]).sort()).toEqual([
      'category',
      'code',
      'count',
      'firstAt',
      'lastAt',
    ]);
  });

  it('reset 清空条目与截断标记', () => {
    const recorder = createDiagnosticRecorder({ limit: 1, now: () => 0 });
    recorder.record('detection', 'no-input', 0);
    recorder.record('protocol', 'invalid-json', 1);
    expect(recorder.snapshot(CONTEXT, 2).truncated).toBe(true);

    recorder.reset();
    const empty = recorder.snapshot(CONTEXT, 3);
    expect(recorder.size).toBe(0);
    expect(empty.entries).toEqual([]);
    expect(empty.truncated).toBe(false);
  });

  it('摘要只展示分类计数，无记录时明确说明不含聊天内容', () => {
    const recorder = createDiagnosticRecorder({ now: () => 0 });
    expect(summarizeDiagnostics(recorder.snapshot(CONTEXT, 0))).toBe(
      '本地诊断：尚未记录到信号（不包含聊天内容）',
    );

    recorder.record('detection', 'no-input');
    recorder.record('protocol', 'invalid-json');
    expect(summarizeDiagnostics(recorder.snapshot(CONTEXT, 0))).toBe(
      '本地诊断：共 2 次本地信号（识别 1 次、协议 1 次），明细见下方预览',
    );
  });
});
