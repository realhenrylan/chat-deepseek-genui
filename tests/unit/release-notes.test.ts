import { describe, expect, it } from 'vitest';
import { renderReleaseNotes } from '../../scripts/release-notes';

describe('Release 草稿更新说明', () => {
  it('提取待发布条目，翻译分类，并排除历史版本内容', () => {
    const notes = renderReleaseNotes(`# Changelog
## Unreleased
### Added
- 新控件
### Changed
- 调整默认设置
### Fixed
- 修复显示问题（尚未真实模型复测）
### Removed
- 移除旧入口
## 0.1.1（历史）
### Added
- 已经发布的功能
`, '0.1.2');
    expect(notes).toContain('### 新增\n- 新控件');
    expect(notes).toContain('### 更改\n- 调整默认设置');
    expect(notes).toContain('### 修复\n- 修复显示问题（尚未真实模型复测）');
    expect(notes).toContain('### 移除\n- 移除旧入口');
    expect(notes).not.toContain('已经发布的功能');
  });

  it('优先使用已整理的目标版本，不混入其他待发布内容', () => {
    const notes = renderReleaseNotes(`## Unreleased
- 下一个版本的工作
## [0.1.2] - 2026-11-03
### Fixed
- 本版修复
## 0.1.1
- 更早版本
`, '0.1.2');
    expect(notes).toContain('本版修复');
    expect(notes).not.toContain('下一个版本的工作');
    expect(notes).not.toContain('更早版本');
  });

  it('版本号精确匹配，兼容现有中文日期标题', () => {
    const notes = renderReleaseNotes(`## 0.1.20
- 其他版本
## 0.1.2（2026-11-03，发布记录）
- 目标版本
`, '0.1.2');
    expect(notes).toContain('目标版本');
    expect(notes).not.toContain('其他版本');
  });

  it('缺少分类时不编造新增或移除项目', () => {
    const notes = renderReleaseNotes('## Unreleased\r\n### Fixed\r\n- 一个修复\r\n', '0.1.2');
    expect(notes).toContain('### 修复');
    expect(notes).not.toContain('### 新增');
    expect(notes).not.toContain('### 移除');
  });

  it('保留代码示例中的二级标题，不误认为版本分界', () => {
    const notes = renderReleaseNotes('## Unreleased\n### Added\n```text\n## 示例标题\n```\n- 本版新增\n## 0.1.1\n- 历史条目', '0.1.2');
    expect(notes).toContain('## 示例标题');
    expect(notes).toContain('本版新增');
    expect(notes).not.toContain('历史条目');
  });

  it.each(['## Unreleased\n### Added\n', '## 0.1.1\n- 旧版内容'])('说明为空或缺失时停止，避免生成无说明的草稿', (changelog) => {
    expect(() => renderReleaseNotes(changelog, '0.1.2')).toThrow('No release notes');
  });

  it('拒绝把提示词等其他格式的版本当作插件版本', () => {
    expect(() => renderReleaseNotes('## Unreleased\n- 新增', 'v2.2')).toThrow('Expected a release version');
  });
});
