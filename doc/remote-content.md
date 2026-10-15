# 邮件远程内容

网页邮件详情和 Telegram Quick View 默认屏蔽远程图片、媒体、字体及 CSS 引用，当前仍有下文列出的已知例外。两端使用 `shared/email-resources.js` 处理 URL、CSS 和 `srcset`，按 URL 解析结果识别反斜杠、控制字符等非常规外链写法。网页端保留 DOMPurify 清洗，Telegram 保留不允许脚本、同源身份与表单提交的 iframe 沙箱。

网页回复、回复全部、转发及重新打开草稿时，原文在传入 TinyMCE 前执行同一套清洗和资源拦截，不继承详情页的远程内容放行状态。引用中的远程图片改为占位图，CSS、媒体及 `srcset` 外链同样受限；文字、本站附件及本地上传图片保留。用户在编辑器中主动添加的内容不经过这个导入流程。

点击“显示远程内容”后，网页端通过登录会话向 `POST /api/email/remote-content` 提交邮件 ID，服务端沿用邮件详情权限检查；Telegram 则通过原 Quick View 链接的 `remote=1` 参数重新验证预览凭据。客户端不能提交任意目标 URL 获得代理签名。

服务端只对邮件中的引用签发独立、最长十分钟有效的资源 URL；Telegram 资源授权不会超过原预览期限。`GET /api/email/resource/:token` 校验签名、用途和有效期后，通过 Worker 加载资源。外部 CSS 的相对导入、图片、字体和 `image-set()` 候选继续改写为代理地址，包括与发件人样式表同源、路径形如本站代理的引用；子资源凭据不会延长上级有效期。正文链接仍需用户主动点击，并以 `noopener noreferrer nofollow` 另开窗口。

## 隐私边界

- 代理失败不回退浏览器直连。
- 应用层请求头从零构造，仅包含资源类型对应的 `Accept`、固定 `Accept-Encoding: identity`、固定 iOS 18.6 Safari 的 User-Agent，以及匿名化的 IP、地区请求头。访客的 Cookie、Authorization、Referer、Origin、语言、Client Hints 和自定义请求头不转发；上游 Cookie、重定向及其他响应头不透传。DNS 请求、资源请求和各跳重定向共用此策略。
- 白名单约束的是 Worker 主动发送的头；Cloudflare 仍会附加 `CF-Worker` 等平台请求头，不能承诺最终网络请求只包含应用层白名单。参见 [Cloudflare 请求头说明](https://developers.cloudflare.com/fundamentals/reference/http-headers/)。
- 预览、代理正文和资源响应禁止缓存。资源响应设置 `nosniff` 和禁止活动内容的 CSP。
- 本站和已配置对象存储域名的普通图片继续直接显示。导入的样式表经过代理；内联 `data:` 样式表不允许导入。
- 代理隐藏的是访客网络身份。发件人仍可通过资源 URL 中的唯一标识记录主动加载时间，代理不能消除这种阅读回执。

## 已知限制

当前仍有以下边界：

- 有效的本站资源代理 URL 可跨邮件复用。拥有站内账号的发件人可在短期凭据失效前将其嵌入另一封邮件，使默认查看触发代理请求；发送方能记录阅读时间，但该路径仍隐藏访客 IP。
- 用户主动显示远程内容后，条件 CSS、`picture` 和 `srcset` 仍由浏览器按本机环境选择资源。发件人可从被请求的不同 URL 推断视口区间、主题偏好或部分浏览器能力；固定代理 UA 不会改变这种选择。这条路径仍隐藏访客 IP 和真实 UA。

## 服务端边界

代理仅允许 HTTP/HTTPS 默认端口，不允许目标凭据、IP 字面量、本地名称或当前 Worker 自身。每一跳重定向都重新校验目标及 A/AAAA DNS 结果，任一非公网地址都会拒绝。代理仅返回图片、CSS、字体和音视频资源；HTML 等响应拒绝返回。

每次请求最多五次重定向，总网络期限十五秒。二进制响应最多 10 MiB，CSS 最多 512 KiB，均按实际读取字节检查，不依赖上游的 Content-Length。失败返回明确的 HTTP 错误；网页端申请代理正文失败时保持屏蔽并显示错误。

该实现依赖 Cloudflare Workers 标准公网 `fetch` 的网络隔离，未使用 VPC、服务绑定或自建内网出口。DNS 预检不等于连接地址钉扎，不能把本实现直接搬到可访问内网的 Node/VPS 代理并宣称同等 SSRF 防护。
