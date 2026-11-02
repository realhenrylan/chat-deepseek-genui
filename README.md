# DeepSeek GenUI（非官方）

为 [chat.deepseek.com](https://chat.deepseek.com) 提供交互式 GenUI 增强的浏览器扩展。**本项目为独立开发的第三方扩展，与 DeepSeek 官方无关**，依赖 DeepSeek 网页版的页面结构，网页改版可能导致功能失效。

## 当前状态（2026-11-02）

阶段 1「工程初始化与最小扩展」已完成：工程骨架、构建配置、锁文件、检查命令与最小扩展可加载。**当前扩展尚不具备任何 GenUI 功能**——它只在 `https://chat.deepseek.com/*` 注入内容脚本并写入一个生命周期标记，用于验证加载链路。产品目标与阶段计划见 [docs/development-task.md](docs/development-task.md)，安全与工程约束见 [docs/development-guide.md](docs/development-guide.md)，真实网页调查见 [docs/compatibility-investigation.md](docs/compatibility-investigation.md)。

## 环境要求

- Node.js v24.15.0、npm 11.12.1（本仓库实际验证版本；其他版本未验证）
- 桌面 Edge（验证版本 156.0.4314.50）或 Chrome（验证版本 156.0.8078.79），Windows 11 下验证

## 安装与检查命令

```bash
npm ci                # 按 package-lock.json 安装锁定依赖
npm run typecheck     # tsc --noEmit 类型检查
npm run lint          # eslint . 代码检查
npm test              # vitest run 单元测试
npm run build         # vite build → dist/，postbuild 自动执行生产包静态校验
npm run check         # 聚合：typecheck + lint + test + build（含生产包校验）
npm run test:e2e      # Playwright：在 Edge/Chrome 加载 dist 并验证注入
```

e2e 可选环境变量（PowerShell 语法：`$env:REAL_SITE=1; npm run test:e2e`）：

- `REAL_SITE=1` — 不拦截导航，访问真实 `https://chat.deepseek.com` 取证；默认拦截并返回本地模拟页面，离线稳定可跑。
- `HEADED=1` — 强制有头模式（无头不支持扩展加载时用于人工取证）。

## 本地加载扩展

1. `npm run build` 生成构建产物目录 `dist/`（含 `manifest.json`、`content.js`）。
2. Edge：打开 `edge://extensions`，开启「开发人员模式」，选择「加载解压缩的扩展」，选中本仓库的 `dist/` 目录。
3. Chrome：打开 `chrome://extensions`，开启「开发者模式」，「加载已解压的扩展程序」选中 `dist/`。
4. 访问 `https://chat.deepseek.com/`，页面根元素出现 `data-genui-ext-loaded="<32位扩展id>"` 即注入成功；重新构建后需在扩展页点击刷新按钮。

## 权限说明（阶段 1 决议）

- `manifest.json` **不申请任何 permissions / host_permissions，无后台 Service Worker**。
- 仅通过 content_scripts 匹配 `https://chat.deepseek.com/*`（页面注入范围本身即访问边界）。
- 按开发指南约定「按实际 API 调用声明权限，不为未实现功能预申请」；`storage` 等权限将在阶段 3 实现增强开关、确实调用对应 API 时再按调用点声明并在此登记。
- 生产包只加载本地资源：构建为 IIFE 单文件，`npm run build` 后自动扫描产物，出现 `eval`/`new Function`/`importScripts`/远程脚本与样式 URL/CDN 域名即构建失败。

## 已验证内容（阶段 1）

| 检查 | 结果 |
| --- | --- |
| `npm run check`（typecheck/lint/11 个单测/build + 生产包校验） | 通过 |
| `npm ci` 后复跑 `npm run check` | 通过 |
| e2e：Edge 156 加载 `dist/` 注入标记，未发现可归因于扩展的错误（模拟页与真实网页；归因依据脚本 URL/堆栈/`[dsgenui]` 日志前缀，无法归因者单列记录、不认定为网站） | 通过 |
| e2e：Chrome 156 同上（基本加载兼容） | 通过 |
| 生产包静态校验负向测试（人为注入 `eval(` → 构建失败） | 通过 |
| 权限审查：manifest 零权限、零后台、匹配范围严格限定 | 通过 |

未验证/不做宣称：任何 GenUI 渲染、协议、交互功能；Edge Add-ons 商店提交与审核（未提交）。

## 目录结构

```
public/manifest.json      MV3 清单（无权限、无后台）
src/content/              内容脚本（生命周期标记，阶段 1 最小实现）
scripts/check-dist.mjs    生产包静态校验（postbuild 自动执行）
tests/unit/               vitest 单元测试
tests/e2e/                Playwright 扩展加载测试
docs/                     产品规格、开发指南、开发任务、兼容性调查
```

## 许可

MIT
