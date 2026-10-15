import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import worker from '../src/index';
import jwtUtils from '../src/utils/jwt-utils';
import {createWorkerEnv} from './helpers/worker-env';

describe('OAuth 绑定身份证明与原子创建', () => {
    let fixture;
    beforeEach(async () => {
        fixture = await createWorkerEnv();
        const setting = JSON.parse(fixture.values.get('setting:'));
        fixture.values.set('setting:', JSON.stringify({...setting, githubSwitch: 0}));
        fixture.sqlite.prepare('INSERT INTO oauth (oauth_user_id, platform) VALUES (?, ?)').run('4242', 'github');
        vi.stubGlobal('fetch', vi.fn(async url => url.includes('/access_token')
            ? Response.json({access_token: 'test-provider-token'})
            : Response.json({id: 4242, login: 'github-user'})));
    });
    afterEach(() => { fixture?.sqlite.close(); vi.unstubAllGlobals(); });

    async function request(path, body, method = 'POST') {
        const response = await worker.fetch(new Request('https://mail.example.com/api' + path, {
            method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
        }), fixture.env, {});
        return response.json();
    }

    async function authorize() {
        const result = await request('/oauth/github/login', {code: 'test-code', redirectUri: 'https://mail.example.com/login'});
        expect(result.code).toBe(200);
        return result.data.bindingToken;
    }

    function bind(email, bindingToken, extra = {}) {
        return request('/oauth/bindUser', {email, bindingToken, ...extra}, 'PUT');
    }

    it('公开 ID 和平台不能代替绑定凭据', async () => {
        const result = await bind('attacker@example.com', undefined, {oauthUserId: '4242', platform: 'github'});
        expect(result.code).toBe(401);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM user').get().count).toBe(0);
    });

    it('真实提供方登录签发短期专用凭据，绑定后才能取得邮箱会话', async () => {
        const token = await authorize();
        expect(typeof token).toBe('string');
        const proof = await jwtUtils.verifyToken({env: fixture.env}, token);
        expect(proof).toMatchObject({purpose: 'oauth-bind', platform: 'github', oauthUserId: '4242'});
        expect(proof.exp - proof.iat).toBe(600);
        const result = await bind('owner@example.com', token);
        expect(result.code).toBe(200);
        expect((await jwtUtils.verifyToken({env: fixture.env}, result.data.token)).userId).toBeGreaterThan(0);
    });

    it.each(['expired', 'missing-expiry', 'wrong-purpose', 'invalid-signature'])('拒绝 %s 凭据且不创建邮箱', async kind => {
        const oauthId = fixture.sqlite.prepare('SELECT oauth_id FROM oauth').get().oauth_id;
        let token = await jwtUtils.generateToken({env: fixture.env}, {
            purpose: kind === 'wrong-purpose' ? 'mail-resource' : 'oauth-bind',
            oauthId, platform: 'github', oauthUserId: '4242',
        }, kind === 'expired' ? -1 : kind === 'missing-expiry' ? undefined : 600);
        if (kind === 'invalid-signature') token = 'invalid-signature';
        const result = await bind('attacker@example.com', token, {oauthUserId: '4242', platform: 'github'});
        expect(result.code).toBe(401);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM user').get().count).toBe(0);
    });

    it('客户端篡改平台和公开 ID 不能改变凭据绑定的身份', async () => {
        const token = await authorize();
        fixture.sqlite.prepare('INSERT INTO oauth (oauth_user_id, platform) VALUES (?, ?)').run('999', 'linuxdo');
        expect((await bind('owner@example.com', token, {oauthUserId: '999', platform: 'linuxdo'})).code).toBe(200);
        expect(fixture.sqlite.prepare('SELECT user_id FROM oauth WHERE platform = ?').get('github').user_id).toBeGreaterThan(0);
        expect(fixture.sqlite.prepare('SELECT user_id FROM oauth WHERE platform = ?').get('linuxdo').user_id).toBe(0);
    });

    it('提供方关闭后已有凭据也不能继续绑定', async () => {
        const token = await authorize();
        const setting = JSON.parse(fixture.values.get('setting:'));
        fixture.values.set('setting:', JSON.stringify({...setting, githubSwitch: 1}));
        expect((await bind('owner@example.com', token, {oauthUserId: '4242', platform: 'github'})).code).not.toBe(200);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM user').get().count).toBe(0);
    });

    it('并发重用凭据只允许一次绑定，不留下额外用户或邮箱', async () => {
        const token = await authorize();
        const results = await Promise.all(['first@example.com', 'second@example.com'].map(email => bind(email, token)));
        expect(results.map(result => result.code).sort()).toEqual([200, 409]);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM user').get().count).toBe(1);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM account').get().count).toBe(1);
        expect((await bind('third@example.com', token)).code).toBe(409);
    });

    it('邮箱写入失败时回滚用户创建和 OAuth 绑定', async () => {
        const token = await authorize();
        fixture.sqlite.exec("CREATE TRIGGER fail_account BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT, 'test-account-failure'); END");
        expect((await bind('owner@example.com', token, {oauthUserId: '4242', platform: 'github'})).code).not.toBe(200);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM user').get().count).toBe(0);
        expect(fixture.sqlite.prepare('SELECT user_id FROM oauth').get().user_id).toBe(0);
    });
});
