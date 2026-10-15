import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import worker from '../src/index';
import {createWorkerEnv} from './helpers/worker-env';
import accountService from '../src/service/account-service';
import userService from '../src/service/user-service';

describe('注册邮箱的加号别名归属', () => {
    let fixture;
    beforeEach(async () => { fixture = await createWorkerEnv(); });
    afterEach(() => fixture?.sqlite.close());

    async function register(email) {
        const response = await worker.fetch(new Request('https://mail.example.com/api/register', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email, password: 'test-password'}),
        }), fixture.env, {});
        return response.json();
    }

    it('公开注册不能抢注已存在主邮箱的标签地址', async () => {
        expect((await register('victim@example.com')).code).toBe(200);
        expect((await register('victim+bank@example.com')).code).toBe(403);
        expect(await accountService.selectByEmailIncludeDel(fixture.context(), 'victim+bank@example.com')).toBeUndefined();
    });

    it('主邮箱尚不存在时也不能把标签地址注册为主账号', async () => {
        expect((await register('new+tag@example.com')).code).toBe(403);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM user').get().count).toBe(0);
    });

    it('普通注册及主邮箱所有者添加标签地址保持可用', async () => {
        expect((await register('owner@example.com')).code).toBe(200);
        const owner = await userService.selectByEmail(fixture.context(), 'owner@example.com');
        const tag = await accountService.add(fixture.context(), {email: 'owner+tag@example.com'}, owner.userId);
        expect(tag.userId).toBe(owner.userId);
        expect(tag.email).toBe('owner+tag@example.com');
    });
});
