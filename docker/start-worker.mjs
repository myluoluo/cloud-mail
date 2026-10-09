import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

if (!process.env.LOCAL_JWT_SECRET) throw new Error('缺少 LOCAL_JWT_SECRET');

await writeFile('/tmp/wrangler-local.json', JSON.stringify({
  name: 'cloud-mail-local',
  main: '/app/mail-worker/src/index.js',
  compatibility_date: '2025-06-04',
  dev: { ip: '0.0.0.0', port: 8787 },
  d1_databases: [{ binding: 'db', database_name: 'mail-local', database_id: '00000000-0000-0000-0000-000000000001' }],
  kv_namespaces: [{ binding: 'kv', id: '00000000000000000000000000000001' }],
  assets: { binding: 'assets', directory: '/app/mail-worker/dist' },
  vars: {
    domain: ['cloudmail.test'],
    admin: 'xiaobo@cloudmail.test',
    jwt_secret: process.env.LOCAL_JWT_SECRET,
    ai_model: '',
    analysis_cache: false,
    orm_log: false,
  },
}));

const worker = spawn('pnpm', ['exec', 'wrangler', 'dev', '--local', '--config', '/tmp/wrangler-local.json', '--persist-to', '/data'], { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => worker.kill(signal));
worker.on('exit', code => process.exit(code ?? 1));
