# 美学 issues 与现有议题的冲突、重叠检查

核对日期：2026-11-03。通过已连接 GitHub 读取仓库现有 10 个 issues 的正文，并单独搜索美学议题；当前未发现与 D01–D06 完全相同的现有 issue。以下区分业务范围重叠、设计冲突风险和共同代码模块。

## 对照结果

| 已有 issue | 相关新 issue | 风险与处理 |
| --- | --- | --- |
| [#1 函数采样与动态视口](https://github.com/realhenrylan/chat-deepseek-genui/issues/1) | D06 | 同改 charts.tsx；采样、坐标映射、零点轴和数学语义仍归 #1。D06 仅改默认配色、文字、网格和已有系列的呈现，按顺序合入并保留数学用例 |
| [#2 状态保持与恢复](https://github.com/realhenrylan/chat-deepseek-genui/issues/2) | D01、D03–D06 | 响应式重建 DOM 可能加剧丢值；新议题采用 CSS 排列和稳定组件树，验证自身主题/宽度/详情变化不丢值。跨挂载、刷新及持久化仍归 #2 |
| [#3 失败反馈与修复草稿](https://github.com/realhenrylan/chat-deepseek-genui/issues/3) | D04、D05 | 避免重复失败状态机或藏起错误。仅统一现有错误外观及入口层级，生成诊断、修复流程继续归 #3 |
| [#4 可组合业务能力](https://github.com/realhenrylan/chat-deepseek-genui/issues/4) | D02、D06 | 展示 emphasis 与业务语义容易混淆；新字段只表达视觉主次，不实现公式、权重、评分或业务默认值，计算保持原快照 |
| [#5 继续讨论快照](https://github.com/realhenrylan/chat-deepseek-genui/issues/5) | D05、D06 | 保留现有 onContinue 接口；新议题不新增表格选择或摘要字段，不重复业务状态传递 |
| [#6 方案保存与比较](https://github.com/realhenrylan/chat-deepseek-genui/issues/6) | D05、D06 | 保留单卡比较表和现有操作；不新增方案保存、导入导出、多方案界面或持久化 |
| [#7 提示词与单轮控制](https://github.com/realhenrylan/chat-deepseek-genui/issues/7) | D02、D03 | 同改 prompt.ts；只同步展示字段及布局组合说明，协调版本更新。精简、误触发与单轮模式继续归 #7 |
| [#8 来源、假设与缺失](https://github.com/realhenrylan/chat-deepseek-genui/issues/8) | D02、D03、D05、D06 | “细节折叠”不能隐藏影响理解的信息。只收起插件元信息或原始数据核对表；关键来源、假设、示例标记、风险和错误保持可见，不把缺失当 0，不暗示事实已验证 |
| [#9 页面适配与侧栏](https://github.com/realhenrylan/chat-deepseek-genui/issues/9) | D01、D03 | 局部容器适配与未来侧栏有交点；只复用现有主题与聊天卡片，不引入适配层重构、侧栏或权限 |
| [#10 产品路线图](https://github.com/realhenrylan/chat-deepseek-genui/issues/10) | 全部 | 作为独立视觉改善系列，不取代可靠性、状态与任务闭环的既有优先顺序；不重复创建业务路线图 |

## 已修订的范围

- D05 明确只折叠插件技术信息，排除关键来源、假设、错误和风险。
- D06 排除 #1 的采样、动态视口与零点轴，以及 #4 的业务计算。
- D02 只新增有限的展示语义；实施前对齐 #1/#4 当时已落地的协议策略，避免并行定义竞争版本。当前规划沿用 v3 可选字段，不升级版本号；旧扩展读取新字段的限制写清。
- D01–D06 保持现有 state/derived、求值快照与回调语义，主题、宽度和详情变化不主动重新挂载。
- D02/D04 对共同 interactive.tsx 顺序实施；D06 与 #1 对共同 charts.tsx 顺序合入。

## 结论

现有议题与美学系列存在可协调的交叉，并非互斥设计。六个美学议题已作为 #11–#16 发布，并用以上范围切分和链接避免重复立项。未修改、关闭或替代任何原有 #1–#10。

发布前已完成正文范围核对；后续实施仍需检查相关 issues 的最新进展，不能以本次快照假定其他工作未发生变化。
