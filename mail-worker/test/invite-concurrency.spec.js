import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import worker from '../src/index';
import kvConst from '../src/const/kv-const';
import {settingConst} from '../src/const/entity-const';
import {createWorkerEnv} from './helpers/worker-env';
import loginService from '../src/service/login-service';

describe('邀请码名额与账号创建原子提交', () => {
    let fixture;
    beforeEach(async () => {
        fixture = await createWorkerEnv();
        fixture.sqlite.prepare('INSERT INTO reg_key (code, count, role_id, expire_time) VALUES (?, ?, ?, ?)')
            .run('one-use', 1, 1, '2099-01-01 00:00:00');
        const settings = await fixture.env.kv.get(kvConst.SETTING, {type: 'json'});
        await fixture.env.kv.put(kvConst.SETTING, JSON.stringify({...settings, regKey: settingConst.regKey.OPEN}));
    });
    afterEach(() => fixture?.sqlite.close());

    async function register(email, code = 'one-use') {
        const response = await worker.fetch(new Request('https://mail.example.com/api/register', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email, code, password: 'test-password'}),
        }), fixture.env, {});
        return response.json();
    }

    it.each([settingConst.regKey.OPEN, settingConst.regKey.OPTIONAL])('模式 %s 并发使用一次名额只创建一个完整账号', async regKey => {
        const settings = await fixture.env.kv.get(kvConst.SETTING, {type: 'json'});
        await fixture.env.kv.put(kvConst.SETTING, JSON.stringify({...settings, regKey}));
        const results = await Promise.all([register('first@example.com'), register('second@example.com')]);
        expect(results.filter(result => result.code === 200)).toHaveLength(1);
        expect(fixture.sqlite.prepare('SELECT count FROM reg_key').get().count).toBe(0);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM user').get().count).toBe(1);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM account').get().count).toBe(1);
        expect(fixture.sqlite.prepare('SELECT reg_key_id FROM user').get().reg_key_id).toBe(1);
    });

    it('邮箱写入失败回滚用户和名额，修复失败原因后可重试', async () => {
        fixture.sqlite.exec("CREATE TRIGGER fail_account BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT, 'test failure'); END");
        expect((await register('retry@example.com')).code).not.toBe(200);
        expect(fixture.sqlite.prepare('SELECT count FROM reg_key').get().count).toBe(1);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM user').get().count).toBe(0);
        fixture.sqlite.exec('DROP TRIGGER fail_account');
        expect((await register('retry@example.com')).code).toBe(200);
        expect(fixture.sqlite.prepare('SELECT count FROM reg_key').get().count).toBe(0);
    });

    it('已过期的邀请码不消耗名额或留下账号', async () => {
        fixture.sqlite.prepare('UPDATE reg_key SET expire_time = ?').run('2000-01-01 00:00:00');
        expect((await register('expired@example.com')).code).not.toBe(200);
        expect(fixture.sqlite.prepare('SELECT count FROM reg_key').get().count).toBe(1);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM user').get().count).toBe(0);
    });

    it('可选邀请码未填写时使用默认角色注册', async () => {
        const settings = await fixture.env.kv.get(kvConst.SETTING, {type: 'json'});
        await fixture.env.kv.put(kvConst.SETTING, JSON.stringify({...settings, regKey: settingConst.regKey.OPTIONAL}));
        expect((await register('normal@example.com', '')).code).toBe(200);
        expect(fixture.sqlite.prepare('SELECT reg_key_id FROM user').get().reg_key_id).toBe(0);
        expect(fixture.sqlite.prepare('SELECT count FROM reg_key').get().count).toBe(1);
    });

    it('已验证 OAuth 注册也不能并发超用邀请码，失败方身份保持未绑定', async () => {
        for (const subject of ['first', 'second']) {
            fixture.sqlite.prepare('INSERT INTO oauth (platform, oauth_user_id) VALUES (?, ?)').run('github', subject);
        }
        const results = await Promise.allSettled([1, 2].map(oauthId => loginService.register(fixture.context(), {
            email: `oauth${oauthId}@example.com`, password: 'test-password', code: 'one-use',
        }, {oauthId})));
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(fixture.sqlite.prepare('SELECT count FROM reg_key').get().count).toBe(0);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM user').get().count).toBe(1);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM account').get().count).toBe(1);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM oauth WHERE user_id > 0').get().count).toBe(1);
    });
});
