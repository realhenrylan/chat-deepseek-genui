/**
 * 阶段 6：站点主题检测与监听。
 *
 * 取证（docs/compatibility-investigation.md §3.1）：
 * - 暗色：`<body class="zh_CN dark" data-ds-dark-theme="dark">`
 * - 浅色：`<body class="zh_CN light">`（`data-ds-dark-theme` 属性消失）
 * - 三选一设置在侧栏「系统设置」中；跟随系统时属性与 class 的规律不变，
 *   因此本模块只观察页面标记，不做系统设置推断。
 *
 * 检测优先级：data-ds-dark-theme 属性 > body class > documentElement class >
 * prefers-color-scheme（可调用时）> light。卡片与开关一律只消费
 * data-site-theme 属性值，保证视觉与站点切换同步。
 */

/** 卡片与开关消费的主题值：只区分暗/亮。 */
export type SiteTheme = 'dark' | 'light';

export function detectSiteTheme(doc: Document): SiteTheme {
  const explicit = doc.body?.getAttribute('data-ds-dark-theme');
  if (explicit === 'dark') return 'dark';

  const bodyClass = doc.body?.className ?? '';
  if (/\bdark\b/.test(bodyClass)) return 'dark';
  if (/\blight\b/.test(bodyClass)) return 'light';

  const rootClass = doc.documentElement?.className ?? '';
  if (/\bdark\b/.test(rootClass)) return 'dark';
  if (/\blight\b/.test(rootClass)) return 'light';

  const view = doc.defaultView;
  if (view && typeof view.matchMedia === 'function') {
    return view.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function watchSiteTheme(
  doc: Document,
  onChange: (theme: SiteTheme) => void,
): () => void {
  let current = detectSiteTheme(doc);
  const apply = () => {
    const next = detectSiteTheme(doc);
    if (next !== current) {
      current = next;
      onChange(next);
    }
  };

  // documentElement + childList 同时覆盖「body 后插入」（inert 文档、
  // 部分聊天流式重建场景）与 body/documentElement 的 class 变化。
  const observer = new MutationObserver(apply);
  observer.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-ds-dark-theme'],
    childList: true,
    subtree: true,
  });

  const view = doc.defaultView;
  const media =
    view && typeof view.matchMedia === 'function'
      ? view.matchMedia('(prefers-color-scheme: dark)')
      : null;
  if (media) {
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', apply);
    } else if (typeof media.addListener === 'function') {
      media.addListener(apply);
    }
  }

  return () => {
    observer.disconnect();
    if (media) {
      if (typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', apply);
      } else if (typeof media.removeListener === 'function') {
        media.removeListener(apply);
      }
    }
  };
}

/**
 * 把检测结果写到元素上的 data-site-theme 属性，并保持跟随；返回幂等清理。
 * 卡片根（shadow 内 container）与页面级开关 host 都用这一入口。
 */
export function attachThemeAttribute(element: Element, doc: Document): () => void {
  element.setAttribute('data-site-theme', detectSiteTheme(doc));
  return watchSiteTheme(doc, (theme) => {
    element.setAttribute('data-site-theme', theme);
  });
}
