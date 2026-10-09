# 第一版 UI 与 XSS 修复回归核对

| 本次改动引入的安全问题 | 数量 |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

2026-10-10，基于分支 `codex/ui-letter-workbench` 的当前工作区检查。结论限于本次界面改动与邮件展示链路，未发现相对于 XSS 修复提交 `83aa25fb0cffa4d28d6fd548fc98d5d445570b17` 的安全回归；不是整个项目无漏洞的保证。

## 界面调整

- Docker 开发预览启用 `VITE_POCKET_ID_PREVIEW=true`，显示 Pocket ID 主按钮与密码登录切换。按钮调用原有授权接口，本地未配置身份服务时明确报错。生产模式忽略预览开关，继续由后端 `pocketIdSwitch` 决定是否展示入口。
- 输入框外框负责焦点提示，避免全局 `[tabindex]:focus-visible` 再给内部输入区域画一圈边框；统一标签输入框的圆角，并提高收件人、抄送与密送标签的文字对比度。
- 保留此前邮箱齿轮及菜单项的焦点边框修复。本次未修改认证后端或正文净化策略。

## XSS 防护链路

置信度：高，依据当前源码比较和针对性单元测试。

- `views/content/index.vue` 的 HTML 邮件仍传给 `ShadowHtml`，域名占位符替换后再进入 `buildEmailContent`，未新增直接渲染原始正文的入口。
- `components/shadow-html/index.vue` 与 `utils/email-html.js` 相对 `83aa25f` 未变化：正文经 DOMPurify 清洗后才写入 Shadow DOM，正文 body 样式不拼入外壳样式表；保留危险标签、事件、协议、CSS 和远程资源处理策略。
- 用户主动放行远程资源后仍执行 HTML 清洗；新增组件回归用例核对事件和脚本仍被移除，切换另一封邮件后重新拦截远程资源。
- Worker 的 HTML/纯文本邮件模板相对 `83aa25f` 未变化：保留正文字符串转义、纯文本转义，以及不允许脚本、同源身份、表单和顶层导航的 sandbox iframe。
- TinyMCE 编辑器与回复/转发业务逻辑相对该提交未变。本次没有向浏览器投递攻击邮件或执行真实 XSS 载荷。

## 验证

| 验证范围 | 当前结果 |
| --- | --- |
| 前端 `mail-login`、`mail-link`、`email-html`、`shadow-html` | 4 个文件，32 项通过 |
| Worker `email-template`、`telegram-preview` | 2 个文件，16 项通过；设置 60 秒硬超时 |
| 新增 Pocket ID 开发预览行为 | 修改前因按钮不存在失败；修改后通过，包含密码切换、授权调用与生产模式忽略预览开关 |
| Docker 浏览器检查 | 桌面与手机登录布局、密码登录进入收件箱、写信窗口的抄送/密送焦点样式正常 |
| 差异检查 | `git diff --check` 通过；认证依赖和 XSS 核心实现与修复提交一致 |

本次是局部修改，由主 Agent 自检，未派独立视觉评审，未运行全量构建或整站测试。

## 依赖审计补充

前端 `pnpm audit --prod --json` 报出 8 个依赖包的 17 条既有公告（High 10、Moderate 7）。依赖清单与锁文件相对 `83aa25f` 未变化，因此这些不是本次 UI 改动新增的问题。公告命中不等同于当前业务路径已确认可利用，本次未升级依赖。

与 XSS 相关的三条公告及当前路径核对：

| 依赖 | 当前版本 | 公告条件与当前链路 |
| --- | --- | --- |
| `@vue/server-renderer` | 3.5.20 | [GHSA-g2v6-rqmx-r4w6](https://github.com/advisories/GHSA-g2v6-rqmx-r4w6) 涉及 SSR 动态属性；当前页面为客户端 Vue 渲染，未发现 SSR 调用。 |
| `postcss` | 8.5.6 | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) 涉及把不可信 CSS 的序列化结果嵌入 HTML；本项目该依赖来自 Vue SFC 编译器，邮件正文处理未调用 PostCSS。 |
| `echarts` | 5.6.0 | [GHSA-fgmj-fm8m-jvvx](https://github.com/advisories/GHSA-fgmj-fm8m-jvvx) 涉及 `Lines` 系列的默认 tooltip；当前注册的是 `LineChart` 等图表，未注册或使用 `Lines` 系列。 |

DOMPurify 未被本次审计公告命中。其余公告保留在原始审计结果中，不将本次邮件展示回归核对扩大为对所有传递依赖的可利用性结论。

## 证据

- [桌面 Pocket ID 登录效果](shots/pocket-id-desktop-ready/page-@2x.png)
- [手机 Pocket ID 登录效果](shots/pocket-id-preview/page-390x844-@2x.png)
- [输入框修改前](shots/compose-input-before/page-@2x.png)
- [输入框修改后](shots/compose-input-after/page-@2x.png)
- [原始依赖审计 JSON](shots/security/dependency-audit.json)

截图与原始审计结果位于已忽略的 `shots` 目录，只保留在本地。
