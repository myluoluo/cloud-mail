import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import worker from '../src/index';
import userService from '../src/service/user-service';
import loginService from '../src/service/login-service';
import {createWorkerEnv} from './helpers/worker-env';

describe('用户列表不暴露密码验证材料', () => {
    let fixture;
    let viewerToken;
    let adminToken;

    beforeEach(async () => {
        fixture = await createWorkerEnv();
        fixture.sqlite.prepare('INSERT INTO role (name, key) VALUES (?, ?)').run('readonly', 'readonly');
        const roleId = fixture.sqlite.prepare('SELECT role_id FROM role WHERE key = ?').get('readonly').role_id;
        fixture.sqlite.prepare("INSERT INTO role_perm (role_id, perm_id) SELECT ?, perm_id FROM perm WHERE perm_key = 'user:query'").run(roleId);
        await userService.add(fixture.context(), {email: 'admin@example.com', password: 'test-password'});
        await userService.add(fixture.context(), {email: 'viewer@example.com', password: 'test-password', type: roleId});
        viewerToken = await loginService.login(fixture.context(), {email: 'viewer@example.com', password: 'test-password'});
        adminToken = await loginService.login(fixture.context(), {email: 'admin@example.com', password: 'test-password'});
    });
    afterEach(() => fixture?.sqlite.close());

    async function list(token) {
        const response = await worker.fetch(new Request('https://mail.example.com/api/user/list?num=1&size=50', {
            headers: {Authorization: token},
        }), fixture.env, {});
        return response.json();
    }

    it.each(['viewer', 'admin'])('%s 查询保留展示字段但不返回哈希或盐', async actor => {
        const result = await list(actor === 'viewer' ? viewerToken : adminToken);
        expect(result.code).toBe(200);
        expect(result.data.total).toBe(2);
        for (const row of result.data.list) {
            expect(Object.hasOwn(row, 'password')).toBe(false);
            expect(Object.hasOwn(row, 'salt')).toBe(false);
            expect(row).toMatchObject({userId: expect.any(Number), email: expect.any(String),
                type: expect.any(Number), status: 0, accountCount: 1, sendAction: expect.any(Object)});
        }
    });

    it('查看用户权限不会同时获得改密权限', async () => {
        const response = await worker.fetch(new Request('https://mail.example.com/api/user/setPwd', {
            method: 'PUT', headers: {Authorization: viewerToken, 'Content-Type': 'application/json'},
            body: JSON.stringify({userId: 1, password: 'other-password'}),
        }), fixture.env, {});
        expect((await response.json()).code).toBe(403);
    });
});
