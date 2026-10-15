import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import worker from '../src/index';
import userService from '../src/service/user-service';
import kvConst from '../src/const/kv-const';
import {createWorkerEnv} from './helpers/worker-env';

describe('管理员 API Token 的验证码保护', () => {
    let fixture;
    let fetchMock;
    beforeEach(async () => {
        fixture = await createWorkerEnv();
        await userService.add(fixture.context(), {email: 'admin@example.com', password: 'admin-password'});
        const settings = await fixture.env.kv.get(kvConst.SETTING, {type: 'json'});
        await fixture.env.kv.put(kvConst.SETTING, JSON.stringify({...settings, siteKey: 'test-site', secretKey: 'test-secret'}));
        fetchMock = vi.fn().mockImplementation(async () => Response.json({success: true, action: 'api-token', hostname: 'mail.example.com'}));
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => { fixture?.sqlite.close(); vi.unstubAllGlobals(); });

    async function generate(extra = {}) {
        const response = await worker.fetch(new Request('https://mail.example.com/api/public/genToken', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email: 'admin@example.com', password: 'admin-password', ...extra}),
        }), fixture.env, {});
        return response.json();
    }

    it('开启验证码后不接受裸密码，也不生成 API Token', async () => {
        expect((await generate()).code).toBe(400);
        expect(fixture.values.has(kvConst.PUBLIC_KEY)).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([{success: false}, {success: true, action: 'login', hostname: 'mail.example.com'},
        {success: true, action: 'api-token', hostname: 'other.example.com'}])('拒绝其他操作或域名的挑战：%j', async result => {
        fetchMock.mockResolvedValue(Response.json(result));
        expect((await generate({token: 'test-challenge'})).code).toBe(400);
        expect(fixture.values.has(kvConst.PUBLIC_KEY)).toBe(false);
    });

    it('有效挑战仍须校验管理员密码，正确时才签发 API Token', async () => {
        expect((await generate({token: 'challenge-1', password: 'wrong-password'})).code).toBe(501);
        expect(fixture.values.has(kvConst.PUBLIC_KEY)).toBe(false);
        const result = await generate({token: 'challenge-2'});
        expect(result.code).toBe(200);
        expect(result.data.token).toBe(fixture.values.get(kvConst.PUBLIC_KEY));
        expect(fetchMock.mock.calls[1][1].body.get('response')).toBe('challenge-2');
    });

    it('未配置验证码的站点保持原有管理员凭据合同', async () => {
        const settings = await fixture.env.kv.get(kvConst.SETTING, {type: 'json'});
        await fixture.env.kv.put(kvConst.SETTING, JSON.stringify({...settings, siteKey: '', secretKey: ''}));
        expect((await generate()).code).toBe(200);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
