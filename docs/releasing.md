# 自动打包与手动发布 GitHub Release

工作流：[`.github/workflows/build-release.yml`](../.github/workflows/build-release.yml)。配置推送到 GitHub 后生效。

## 触发方式

| 操作 | 结果 |
| --- | --- |
| 推送到 `main` | 检查、构建、Edge/Chrome 默认模拟页测试、打包，上传 Actions 下载附件 |
| Actions → Build extension and prepare release draft → Run workflow | 用户填写最终插件版本号，按该版本构建并创建未发布的 Release 草稿 |
| Release 草稿页 → Publish release | 用户决定正式发布，草稿附件成为正式分发包 |
| 推送标签 | 不触发本工作流，不自动正式发布 |

构建任务只有仓库读取权限。草稿任务仅在用户手动运行后执行，使用 GitHub 自动提供的 `GITHUB_TOKEN`（`contents: write`），无需另配个人访问令牌。Actions 下载附件保留 30 天，Release 附件用于正式分发。**最终版本号和正式发布时机都由用户按按钮决定。**

## 发布新版本

1. 推送包含本工作流、脚本和要发布代码的提交，更新 CHANGELOG。
2. 打开 Actions → **Build extension and prepare release draft** → **Run workflow**，选择要打包的分支，在 `version` 填入你决定的最终插件版本号，例如 `0.1.2`，再点击运行。不需要预先创建标签。
3. 构建任务在独立检出目录中同步 `package.json`、`package-lock.json`（顶层及根包）和 `public/manifest.json`，按选定版本执行检查、构建、浏览器测试和打包。
4. 草稿任务校验附件，给同一份源代码应用已验证的版本文件；若版本文件有变化，就创建版本提交，并推送对应标签。该提交只由发布标签引用，不自动修改 `main`。标签的源代码与测试、打包使用的版本文件一致。
5. 到 Releases 打开 `DeepSeek GenUI v0.1.2` **草稿**，核对版本、修改说明、下载并检查 ZIP。确认要发布时，由你点击 **Publish release**；保留草稿就不会正式发布。

插件版本使用不带 `v` 的稳定版 `x.y.z`，每段 0–65535，且不能全为零；例如输入 `0.1.2` 后，安装包版本为 `0.1.2`，标签为 `v0.1.2`。提示词版本（例如 v2.2）独立于插件版本。

选择尚未使用的版本号。若你在填写后改变主意，可取消该运行，或保留、删除草稿；已推送的标签不会随删除草稿自动删除。重新选择版本时，重新手动运行流程，不要仅编辑草稿标题或标签名来更改版本，否则安装包内部版本不会随之改变。

工作流在安装依赖前核对三个版本文件；打包时再次核对构建后的 manifest。标签 `v0.1.2` 对应内部版本为 `0.1.2` 的包。常规 `main` 构建使用仓库中的开发版本，不自动选择新版本号。

草稿任务只接收构建任务生成的附件，不重新构建，并在上传草稿前核对 SHA256。ZIP 根目录直接包含 `manifest.json`、`content.js`、`icons/`、`branding/`，不会多包一层 `dist/`。既有 `release/` 历史文件不作为新包输入。

已有同名标签或 Release 时，草稿步骤会失败，不覆盖历史附件。若失败，先检查标签和草稿的现状，再处理失败原因；不要通过移动旧标签或覆盖历史包来发布新代码。

## 发布说明

手动运行时自动读取 CHANGELOG：优先使用与填写版本完全匹配的小节，否则提取 `Unreleased`。正文分类转为“新增、更改、修复、移除、弃用、安全、验证情况、不兼容更改”；未记录的分类不凭空补条目，缺少说明时停止生成草稿。

这份中文说明会放在草稿正文前部，再附 GitHub 自动生成的 PR、贡献者与完整变更链接。你可以在草稿页核对、修改后再决定发布。说明来自维护的更新日志，不会自动推断所有代码差异；每次发布前应核对条目归属，发布后将本次待发布记录归档为版本小节并更新到 `main`，避免下一次重复带入。

下载附件中同时保留 `release-notes.md`，方便核对本次构建使用的说明；该文件不放入插件 ZIP。

## 本地打包

Windows / PowerShell 7：

```powershell
npm run check
npm run test:e2e
./scripts/package-release.ps1
```

默认生成到 `.tmp/release/`。再次打包时可用 `-OutputDirectory .tmp/release-next` 指定新的目录，已有文件不会被覆盖。仅验证版本可执行 `./scripts/package-release.ps1 -ValidateOnly -Tag v0.1.1`（使用当前实际插件版本）。

## 验证边界

打包流程运行已有单测、类型检查、lint、生产包校验及默认 Edge/Chrome 模拟页测试；真实 origin 合成 DOM 用例按现有设计跳过，不会发送真实模型消息。GitHub Release 不包含扩展商店提交，草稿不等于正式发布。

GitHub Actions 的运行环境与权限需在首次远端执行时验证；本地打包成功不等同于已经完成远端发布。

本轮本地验证（2026-11-03）：`npm run check` 通过（26 个测试文件、261 项单测，含 8 项发布说明提取测试；类型检查、lint、构建和生产包校验）；默认 Edge/Chrome 测试 22 通过、6 个真实 origin 用例按设计跳过；actionlint v1.7.12 检查通过。ZIP 的 7 个文件与 `dist/` 逐字节一致，根目录结构和 SHA256 正确；另验证了用户选择版本的同步、非法版本拒绝且不写文件、版本与标签不匹配、旧构建和缺少文件拒绝、已有包不覆盖。未在本轮创建远端标签、Release 草稿或正式 Release。

参考：[手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、[工作流附件](https://docs.github.com/en/actions/tutorials/store-and-share-data)、[gh release create](https://cli.github.com/manual/gh_release_create)。
