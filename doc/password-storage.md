# 密码存储

新建账号与密码修改使用带随机盐的 PBKDF2-HMAC-SHA256，派生 256 位输出。`password` 字段格式为 `pbkdf2-sha256$100000$<Base64>`，盐仍存储在 `salt` 字段。普通密码登录和管理员 API Token 认证会在旧 SHA-256 密码验证成功后迁移；失败认证不改动记录，OAuth 免密登录不触发密码迁移。

工作因子固定为 100000，符合目前 Workers 生产运行时的单次迭代上限，不能仅凭 Node 或本地 workerd 支持更大值推断线上可用。该值低于 OWASP 对 PBKDF2-HMAC-SHA256 建议的 600000 轮，因此本实现不声称达到该工作因子建议。上游提高生产默认上限的 PR 尚未合并。[Cloudflare 上限讨论及 PR](https://github.com/cloudflare/workerd/pull/7550)、[OWASP 密码存储建议](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

自动生成的密码默认 16 位字母数字字符，由 `crypto.getRandomValues()` 生成并通过拒绝采样消除取模偏差。
