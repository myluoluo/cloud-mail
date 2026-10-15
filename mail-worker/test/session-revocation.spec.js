import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import worker from '../src/index';
import userService from '../src/service/user-service';
import loginService from '../src/service/login-service';
import constant from '../src/const/constant';
import kvConst from '../src/const/kv-const';
import {createWorkerEnv} from './helpers/worker-env';

describe('会话退出和改密撤销', () => {
    let fixture;
    let first;
    let second;
    beforeEach(async () => {
        fixture = await createWorkerEnv();
        await userService.add(fixture.context(), {email: 'admin@example.com', password: 'old-password'});
        first = await loginService.login(fixture.context(), {email: 'admin@example.com', password: 'old-password'});
        second = await loginService.login(fixture.context(), {email: 'admin@example.com', password: 'old-password'});
    });
    afterEach(() => { fixture?.sqlite.close(); vi.restoreAllMocks(); });

    async function request(path, token, body, method = 'GET') {
        const response = await worker.fetch(new Request(`https://mail.example.com/api${path}`, {
            method, headers: {Authorization: token, 'Content-Type': 'application/json'},
            ...(body && {body: JSON.stringify(body)}),
        }), fixture.env, {});
        return response.json();
    }

    it('退出较早会话只撤销自身，其他会话保留有限过期时间', async () => {
        const key = kvConst.AUTH_INFO + 1;
        const before = JSON.parse(fixture.values.get(key));
        expect((await request('/logout', first, null, 'DELETE')).code).toBe(200);
        expect((await request('/my/loginUserInfo', first)).code).toBe(401);
        expect((await request('/my/loginUserInfo', second)).code).toBe(200);
        expect(fixture.metadata.get(key)).toEqual({expiration: Math.floor(Date.parse(before.refreshTime) / 1000) + constant.TOKEN_EXPIRE});
    });

    it('最后一个会话退出后删除会话记录，重复退出不影响其他用户', async () => {
        await request('/logout', second, null, 'DELETE');
        await request('/logout', first, null, 'DELETE');
        expect(fixture.values.has(kvConst.AUTH_INFO + 1)).toBe(false);
        expect((await request('/logout', first, null, 'DELETE')).code).toBe(401);
    });

    it.each(['/my/resetPassword', '/user/setPwd'])('%s 修改密码后所有旧会话失效，新密码可以登录', async path => {
        expect((await request(path, first, {password: 'new-password', userId: 1}, 'PUT')).code).toBe(200);
        expect((await request('/my/loginUserInfo', first)).code).toBe(401);
        expect((await request('/my/loginUserInfo', second)).code).toBe(401);
        await expect(loginService.login(fixture.context(), {email: 'admin@example.com', password: 'old-password'})).rejects.toThrow();
        const next = await loginService.login(fixture.context(), {email: 'admin@example.com', password: 'new-password'});
        expect((await request('/my/loginUserInfo', next)).code).toBe(200);
    });

    it('历史退出留下的过期永久 KV 记录不能通过每日刷新恢复', async () => {
        const key = kvConst.AUTH_INFO + 1;
        const authInfo = JSON.parse(fixture.values.get(key));
        authInfo.refreshTime = new Date(Date.now() - (constant.TOKEN_EXPIRE + 86400) * 1000).toISOString();
        await fixture.env.kv.put(key, JSON.stringify(authInfo));
        expect((await request('/my/loginUserInfo', first)).code).toBe(401);
        expect(fixture.values.has(key)).toBe(false);
    });

    it('会话撤销存储失败时不提交新密码，错误明确返回', async () => {
        vi.spyOn(fixture.env.kv, 'delete').mockRejectedValue(new Error('test KV unavailable'));
        expect((await request('/my/resetPassword', first, {password: 'new-password'}, 'PUT')).code).not.toBe(200);
        await expect(loginService.login(fixture.context(), {email: 'admin@example.com', password: 'new-password'})).rejects.toThrow();
        await expect(loginService.login(fixture.context(), {email: 'admin@example.com', password: 'old-password'})).resolves.toBeTypeOf('string');
    });
});
