import { spawnSync } from 'node:child_process';

if (!process.env.LOCAL_JWT_SECRET || !process.env.LOCAL_MAIL_PASSWORD) throw new Error('缺少本地初始化凭据');

const base = 'http://127.0.0.1:8787/api';
const initialized = await fetch(`${base}/init/${encodeURIComponent(process.env.LOCAL_JWT_SECRET)}`);
if ((await initialized.text()) !== 'success') throw new Error('本地数据库初始化失败');

const response = await fetch(`${base}/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'xiaobo@cloudmail.test', password: process.env.LOCAL_MAIL_PASSWORD }),
});
const result = await response.json();
if (result.code !== 200) throw new Error(`注册本地账户失败：${result.message}`);

const seed = spawnSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'mail-local', '--local', '--config', '/tmp/wrangler-local.json', '--persist-to', '/data', '--file', '/app/docker/seed.sql'], { stdio: 'inherit' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
const login = await fetch(`${base}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'xiaobo@cloudmail.test', password: process.env.LOCAL_MAIL_PASSWORD }),
}).then(response => response.json());
if (login.code !== 200) throw new Error('本地账户登录失败');
const settings = await fetch(`${base}/setting/set`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: login.data.token },
  body: JSON.stringify({ notice: 1, autoRefresh: 0, background: '', loginOpacity: 1 }),
}).then(response => response.json());
if (settings.code !== 200) throw new Error(`本地设置更新失败：${settings.message}`);
console.log('本地账户与邮件已初始化：xiaobo@cloudmail.test');
