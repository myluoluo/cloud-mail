import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import worker from '../src/index';
import {createWorkerEnv} from './helpers/worker-env';
import loginService from '../src/service/login-service';
import jwtUtils from '../src/utils/jwt-utils';

describe('传统 OAuth 平台身份隔离', () => {
    let fixture;
    beforeEach(async () => {
        fixture = await createWorkerEnv();
        const setting = JSON.parse(fixture.values.get('setting:'));
        fixture.values.set('setting:', JSON.stringify({...setting, githubSwitch: 0, linuxdoSwitch: 0}));
        await loginService.register(fixture.context(), {email: 'victim@example.com', password: 'test-password'});
        // 仅替换提供方 HTTP 响应，身份查找、持久化和会话签发使用真实代码。
        vi.stubGlobal('fetch', vi.fn(async url => {
            if (url.includes('/token') || url.includes('/access_token')) return Response.json({access_token: 'test-provider-token'});
            return Response.json({id: 4242, login: 'github-user', username: 'linuxdo-user', name: '测试用户'});
        }));
    });
    afterEach(() => { fixture?.sqlite.close(); vi.unstubAllGlobals(); });

    async function request(path, body, method = 'POST') {
        const response = await worker.fetch(new Request('https://mail.example.com/api' + path, {
            method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
        }), fixture.env, {});
        return response.json();
    }

    function identity(platform, userId = 0) {
        fixture.sqlite.prepare('INSERT INTO oauth (oauth_user_id, platform, user_id, username) VALUES (?, ?, ?, ?)')
            .run('4242', platform, userId, platform + '-original');
    }

    it('不同平台的同号身份不能登录已有用户', async () => {
        identity('github', 1);
        const result = await request('/oauth/linuxDo/login', {code: 'test-code', redirectUri: 'https://mail.example.com/login'});
        expect(result.code).toBe(200);
        expect(result.data.token).toBeNull();
        expect(result.data.userInfo).toMatchObject({platform: 'linuxdo', userId: 0});
        expect(fixture.sqlite.prepare('SELECT user_id FROM oauth WHERE platform = ?').get('github').user_id).toBe(1);
    });

    it('同一平台更新资料后仍登录原绑定用户，其他平台资料不变', async () => {
        identity('github', 1);
        identity('linuxdo');
        const result = await request('/oauth/github/login', {code: 'test-code', redirectUri: 'https://mail.example.com/login'});
        expect(result.code).toBe(200);
        expect(await jwtUtils.verifyToken({env: fixture.env}, result.data.token)).toMatchObject({userId: 1});
        expect(fixture.sqlite.prepare('SELECT username FROM oauth WHERE platform = ?').get('linuxdo').username).toBe('linuxdo-original');
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM oauth').get().count).toBe(2);
    });

    it('绑定只更新所选平台的记录', async () => {
        identity('github');
        identity('linuxdo');
        const authorization = await request('/oauth/github/login', {code: 'test-code', redirectUri: 'https://mail.example.com/login'});
        const result = await request('/oauth/bindUser', {email: 'bound@example.com', bindingToken: authorization.data.bindingToken}, 'PUT');
        expect(result.code).toBe(200);
        expect(fixture.sqlite.prepare('SELECT user_id FROM oauth WHERE platform = ?').get('github').user_id).toBeGreaterThan(0);
        expect(fixture.sqlite.prepare('SELECT user_id FROM oauth WHERE platform = ?').get('linuxdo').user_id).toBe(0);
    });
});
