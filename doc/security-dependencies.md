# 安全依赖更新（2026-10-16）

两端锁文件已更新并用 `pnpm audit --json` 重新核验，当前均返回 0 个已知依赖告警、退出码 0。这是本次 npm 公告匹配结果，不代表应用不存在其他漏洞；静态复制的 TinyMCE 另行核验。

主要安全版本：

| 范围 | 组件 | 当前锁定版本 |
| --- | --- | --- |
| Worker | Hono / Drizzle | 4.13.13 / 0.45.4 |
| Worker | AWS S3 SDK / UAParser / UUID | 3.1152.0 / 2.0.10 / 11.1.1 |
| Worker 工具 | Vitest / Wrangler / Vite | 4.1.12 / 4.151.0 / 7.3.7 |
| Worker 工具 | Cloudflare Vitest plugin | 1.4.3 |
| 前端 | Vue / DOMPurify / lodash-es | 3.5.44 / 3.4.17 / 4.18.1 |
| 前端 | ECharts | 6.1.0 |
| 前端工具 | Vite / Vue plugin / Vitest | 7.3.7 / 6.0.10 / 5.0.5 |
| 前端工具 | PWA plugin / Workbox | 1.3.0 / 7.4.1 |
| 前端工具 | unplugin-vue-components | 32.1.0 |
| 静态编辑器 | TinyMCE | 7.9.3 |

旧 `@cloudflare/vitest-pool-workers` 已按[官方迁移文档](https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-to-vitest-plugin/)替换为 `@cloudflare/vitest-plugin`，移除了旧 Miniflare 依赖链。Worker 显式提供 Vite peer，前端显式提供 Workbox peer，避免包管理器继续复用受影响的旧版本。组件插件升级后，旧 Chokidar → braces 链已移除，无需为没有补丁的 braces 忽略告警或添加覆盖规则。

TinyMCE 来自 npm 官方 `tinymce@7.9.3` 发布包，其 SHA-512 摘要为：

```
sha512-Mtm54U5YJ6Pyo/GaAx+JSHXTGEuxrg2AowVWCD9zy1eBolp5Ub7S1rTtsyQdxhPegfhLuR3VLiTKGw1tacv09g==
```

项目原有的 123 个上游资源文件均与该包逐字节一致；项目语言包及自定义 `css/index.css` 保留。回归测试加载真实编辑器，用无脚本的站内路径验证导入的 `data-mce-href` 不会覆盖已验证链接，覆盖[上游修复路径](https://github.com/tinymce/tinymce/security/advisories/GHSA-q742-qvgc-gc2f)。

TinyMCE 7.9.3 仍内嵌修改版 DOMPurify 3.2.6，不受 pnpm 审计覆盖。[上游原型污染链公告](https://github.com/cure53/DOMPurify/security/advisories/GHSA-v9jr-rg53-9pgp)需要同一执行上下文先存在原型污染。当前集成在导入前使用项目 DOMPurify 3.4.17 清洗，TinyMCE 内部也通过默认启用的 schema hooks 校验标签及属性，且未配置自定义元素；本次未找到相关原型污染入口，因此保留为条件性依赖风险，不将版本匹配直接认定为应用可利用漏洞，也不声称内嵌库已无告警。

验证结果：Worker 21 个文件、190 项测试；前端 9 个文件、51 项测试；前端生产构建与 Wrangler `--dry-run` 均通过。ECharts 的 pie、bar、line、gauge 使用实际模块完成 SVG 渲染检查。没有执行发布、真实邮件发送或远端攻击测试。

`vitest.unit.config.js` 的 Worker 回归运行于 Node fork 与内存 SQLite，隔离 D1/KV 外部边界。`vitest.config.js` 已迁移到新 Cloudflare 插件且模块加载通过，但其原有的 `wrangler.jsonc` 在仓库中缺失，因此本次没有运行该独立 Workers 集成配置，也不把单元测试或 dry-run 当作线上验证。
