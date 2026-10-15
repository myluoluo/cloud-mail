# 管理员 API Token

`POST /api/public/genToken` 使用管理员邮箱和密码签发开放 API Token。请求 JSON 包含 `email`、`password`；站点配置 Turnstile 的 `siteKey` 和 `secretKey` 时，还必须传入 `token`。

此 `token` 必须来自本站 Turnstile widget，widget 的 `action` 设为 `api-token`，并在成功回调中取得挑战结果后立即提交。服务端会验证挑战的成功状态、操作和请求域名；登录页面 `login` 操作的挑战不能替代它。挑战失败、过期或已被使用时，应重新完成挑战，不要重试旧结果。

未配置 Turnstile 的站点保持邮箱和密码认证。签发成功会替换原开放 API Token，返回 `data.token`。后续开放 API 请求在 `Authorization` 头传入该值；无需为每次请求重复签发。
