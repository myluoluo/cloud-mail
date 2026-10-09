# 本地 UI 预览

运行真实 Vue 前端和 Wrangler 本地 Worker。D1、KV 存放在独立 Docker volume，端口只绑定本机回环地址；不需要 Cloudflare 账户，不连接生产服务。

首次运行，在仓库根目录执行：

```sh
python3 -c 'import secrets; from pathlib import Path; p=Path("docker/.env"); p.write_text("LOCAL_JWT_SECRET="+secrets.token_hex(32)+"\nLOCAL_MAIL_PASSWORD="+secrets.token_urlsafe(12)+"\n"); p.chmod(0o600)'
docker compose -f docker/compose.yaml build worker
docker compose -f docker/compose.yaml up -d
docker compose -f docker/compose.yaml exec -T worker node /app/docker/setup-local.mjs
```

确认 Worker 日志显示 Ready 后再初始化。初始化只需对新 volume 执行一次；再次执行注册会明确报账户已存在，不会静默覆盖账户。已有数据时保留 `docker/.env`，直接 `up -d`。

访问 <http://127.0.0.1:3001>。本地测试账户为 `xiaobo@cloudmail.test`，登录框输入 `xiaobo`；密码为 `docker/.env` 的 `LOCAL_MAIL_PASSWORD`。测试数据包含三个邮箱和十一封邮件。收藏、已读、账户切换等操作通过真实本地 API 完成；真实收发邮件、R2 附件和线上 Pocket ID 未配置。

Docker 开发预览通过 `VITE_POCKET_ID_PREVIEW=true` 展示 Pocket ID 按钮，可展开密码登录。按钮仍调用真实授权接口；未配置认证时会明确报错。生产模式忽略此预览开关，入口仍由后端认证配置决定。

前端源码以只读目录挂载，修改后由 Vite 热更新；依赖或 Docker 配置改变时重新构建。

```sh
docker compose -f docker/compose.yaml logs --tail=30
docker compose -f docker/compose.yaml down
```

停止容器会保留数据。环境文件已加入 `.gitignore`，不要提交。
