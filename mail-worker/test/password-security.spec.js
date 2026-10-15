import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {pbkdf2Sync} from 'node:crypto';
import cryptoUtils from '../src/utils/crypto-utils';
import userService from '../src/service/user-service';
import loginService from '../src/service/login-service';
import publicService from '../src/service/public-service';
import {createWorkerEnv} from './helpers/worker-env';

describe('密码 KDF 与安全随机密码', () => {
    afterEach(() => vi.restoreAllMocks());

    it('新哈希携带算法和工作因子，并与独立 PBKDF2 实现一致', async () => {
        const {salt, hash} = await cryptoUtils.hashPassword('test-password');
        expect(hash).toMatch(/^pbkdf2-sha256\$100000\$/);
        expect(hash.split('$')[2]).toBe(pbkdf2Sync('test-password', salt, 100000, 32, 'sha256').toString('base64'));
        expect(await cryptoUtils.verifyPassword('test-password', salt, hash)).toBe(true);
        expect(await cryptoUtils.verifyPassword('wrong-password', salt, hash)).toBe(false);
    });

    it.each(['pbkdf2-sha256$0$bad', 'pbkdf2-sha256$9999999999$bad', 'unknown$100000$bad', 'not-a-hash'])('损坏或不支持的格式不能登录：%s', async hash => {
        expect(await cryptoUtils.verifyPassword('test-password', 'test-salt', hash)).toBe(false);
    });

    it('自动密码不依赖 Math.random，并丢弃会造成取模偏差的随机字节', () => {
        vi.spyOn(Math, 'random').mockImplementation(() => {throw new Error('不允许弱随机源');});
        let calls = 0;
        vi.spyOn(crypto, 'getRandomValues').mockImplementation(bytes => {
            bytes.fill(calls++ === 0 ? 255 : 61);
            return bytes;
        });
        expect(cryptoUtils.genRandomPwd()).toBe('9'.repeat(16));
        expect(calls).toBeGreaterThan(1);
        expect(cryptoUtils.genRandomPwd(24)).toHaveLength(24);
    });
});

describe('历史单轮哈希在成功认证后升级', () => {
    let fixture;
    let legacy;
    beforeEach(async () => {
        fixture = await createWorkerEnv();
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('old-saltold-password'));
        legacy = btoa(String.fromCharCode(...new Uint8Array(digest)));
        await userService.insert(fixture.context(), {email: 'admin@example.com', password: legacy, salt: 'old-salt'});
    });
    afterEach(() => fixture?.sqlite.close());

    it.each(['login', 'public-token'])('%s 认证正确才迁移旧密码，并保持新旧验证兼容', async entry => {
        const authenticate = password => entry === 'login'
            ? loginService.login(fixture.context(), {email: 'admin@example.com', password})
            : publicService.genToken(fixture.context(), {email: 'admin@example.com', password});
        await expect(authenticate('wrong-password')).rejects.toThrow();
        expect((await userService.selectById(fixture.context(), 1)).password).toBe(legacy);
        await authenticate('old-password');
        const updated = await userService.selectById(fixture.context(), 1);
        expect(updated.password).toMatch(/^pbkdf2-sha256\$100000\$/);
        expect(updated.salt).not.toBe('old-salt');
        expect(await cryptoUtils.verifyPassword('old-password', updated.salt, updated.password)).toBe(true);
        await authenticate('old-password');
        expect((await userService.selectById(fixture.context(), 1)).password).toBe(updated.password);
    });

    it('迁移使用比较后更新，不覆盖并发写入的新密码', async () => {
        const stale = await userService.selectById(fixture.context(), 1);
        const replacement = await cryptoUtils.hashPassword('replacement-password');
        fixture.sqlite.prepare('UPDATE user SET password = ?, salt = ? WHERE user_id = ?').run(replacement.hash, replacement.salt, 1);
        expect(await userService.verifyPassword(fixture.context(), stale, 'old-password')).toBe(true);
        const current = await userService.selectById(fixture.context(), 1);
        expect(current.password).toBe(replacement.hash);
        expect(await cryptoUtils.verifyPassword('replacement-password', current.salt, current.password)).toBe(true);
    });
});
