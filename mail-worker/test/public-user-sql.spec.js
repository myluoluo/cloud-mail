import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import worker from '../src/index';
import kvConst from '../src/const/kv-const';
import cryptoUtils from '../src/utils/crypto-utils';
import {createWorkerEnv} from './helpers/worker-env';

describe('开放 API 建用户参数绑定', () => {
    let fixture;
    beforeEach(async () => {
        fixture = await createWorkerEnv();
        await fixture.env.kv.put(kvConst.PUBLIC_KEY, 'test-public-token');
    });
    afterEach(() => fixture?.sqlite.close());

    async function add(list, headers = {}) {
        const response = await worker.fetch(new Request('https://mail.example.com/api/public/addUser', {
            method: 'POST', headers: {Authorization: 'test-public-token', 'Content-Type': 'application/json', ...headers},
            body: JSON.stringify({list}),
        }), fixture.env, {});
        return response.json();
    }

    it('邮箱中的合法引号和 SQL 表达式按原文存入用户及邮箱表', async () => {
        const address = "x'/**/OR/**/1/**/OR/**/'@example.com";
        expect((await add([{email: address, password: 'test-password'}])).code).toBe(200);
        const user = fixture.sqlite.prepare('SELECT * FROM user').get();
        const account = fixture.sqlite.prepare('SELECT * FROM account').get();
        expect(user.email).toBe(address);
        expect(account.email).toBe(address);
        expect(account.name).toBe(address.split('@')[0]);
        expect(account.user_id).toBe(user.user_id);
        expect(await cryptoUtils.verifyPassword('test-password', user.salt, user.password)).toBe(true);
    });

    it('动态请求值中的引号不改变 SQL，批次中的其他用户正常创建', async () => {
        const ip = "192.0.2.1'";
        expect((await add([{email: 'one@example.com'}, {email: 'two@example.com'}], {'cf-connecting-ip': ip})).code).toBe(200);
        const rows = fixture.sqlite.prepare('SELECT email, active_ip, create_ip FROM user ORDER BY user_id').all();
        expect(rows.map(row => row.email)).toEqual(['one@example.com', 'two@example.com']);
        expect(rows.every(row => row.active_ip === ip && row.create_ip === ip)).toBe(true);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM account WHERE user_id > 0').get().count).toBe(2);
    });
});
