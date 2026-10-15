import {DatabaseSync} from 'node:sqlite';
import {dbInit} from '../../src/init/init';

// 仅替换 D1/KV 外部边界；业务查询、建表和路由均运行真实实现。
export async function createWorkerEnv() {
    const sqlite = new DatabaseSync(':memory:');
    const values = new Map();
    const metadata = new Map();
    const prepare = (query, params = []) => ({
        query, params,
        bind(...args) { return prepare(query, args); },
        async raw() { const stmt = sqlite.prepare(query); stmt.setReturnArrays(true); return stmt.all(...params); },
        async all() { return {success: true, results: sqlite.prepare(query).all(...params)}; },
        async first() { return sqlite.prepare(query).get(...params) || null; },
        async run() { return {success: true, meta: sqlite.prepare(query).run(...params)}; },
    });
    const env = {
        domain: ['example.com'], admin: 'admin@example.com', jwt_secret: 'test-only-signing-key',
        db: {
            prepare,
            async batch(statements) {
                sqlite.exec('BEGIN');
                try {
                    const results = statements.map(({query, params}) => ({success: true, results: sqlite.prepare(query).all(...params)}));
                    sqlite.exec('COMMIT');
                    return results;
                } catch (error) {
                    sqlite.exec('ROLLBACK');
                    throw error;
                }
            },
        },
        kv: {
            async get(key, options) {
                const value = values.get(key) ?? null;
                return options?.type === 'json' && value !== null ? JSON.parse(value) : value;
            },
            async put(key, value, options) { values.set(key, value); metadata.set(key, options); },
            async delete(key) { values.delete(key); metadata.delete(key); },
        },
    };
    function context() {
        const state = new Map();
        return {
            env,
            req: {url: 'https://mail.example.com/api/register', param: () => env.jwt_secret,
                header: key => key.toLowerCase() === 'cf-connecting-ip' ? '192.0.2.1' : undefined},
            get: key => state.get(key), set: (key, value) => state.set(key, value), text: value => value,
        };
    }
    try {
        await dbInit.init(context());
        return {env, sqlite, context, values, metadata};
    } catch (error) {
        sqlite.close();
        throw error;
    }
}
