import {afterEach, describe, expect, it, vi} from 'vitest';
import app from '../src/hono/hono';
import BizError from '../src/error/biz-error';

app.get('/audit-error', c => {throw c.env.auditError;});
afterEach(() => vi.restoreAllMocks());

async function fail(error) {
    const response = await app.request('/audit-error', {}, {auditError: error});
    return response.json();
}

describe('内部错误响应边界', () => {
    it('内部异常仅写入服务端日志，不在响应中回显细节', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const error = new Error('SQLITE_ERROR: SELECT secret FROM audit_table; params audit-value');
        error.code = 'SQLITE_ERROR';
        const result = await fail(error);
        expect(result.code).toBe(500);
        expect(JSON.stringify(result)).not.toContain('audit');
        expect(JSON.stringify(result)).not.toContain('SQLITE');
        expect(log).toHaveBeenCalledWith(error);
    });

    it('业务错误保留明确提示和业务状态码', async () => {
        expect(await fail(new BizError('没有权限执行此操作', 403))).toMatchObject({code: 403, message: '没有权限执行此操作'});
    });

    it('普通异常不能仅凭业务错误名称获得对外回显', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const error = new Error('private error detail');
        error.name = 'BizError';
        error.code = 'INTERNAL';
        const result = await fail(error);
        expect(result.code).toBe(500);
        expect(result.message).not.toContain('private');
        expect(log).toHaveBeenCalledWith(error);
    });

    it('保留固定的数据库配置诊断提示，不回显原异常', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const result = await fail(new Error('D1_ERROR: no such column: audit_secret'));
        expect(result.code).toBe(502);
        expect(result.message).toContain('Please update the database');
        expect(JSON.stringify(result)).not.toContain('audit_secret');
    });
});
