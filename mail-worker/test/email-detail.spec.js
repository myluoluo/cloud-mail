import {DatabaseSync} from 'node:sqlite';
import {getTableColumns, getTableName} from 'drizzle-orm';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import email from '../src/entity/email';
import {att} from '../src/entity/att';
import {star} from '../src/entity/star';
import worker from '../src/index';
import jwtUtils from '../src/utils/jwt-utils';
import kvConst from '../src/const/kv-const';
import permService from '../src/service/perm-service';
import settingService from '../src/service/setting-service';
import telegramService from '../src/service/telegram-service';

// 查询经 Drizzle/D1 接口交给真实 SQLite 执行，不模拟查询结果。
function createD1(sqlite) {
    return {
        prepare(query) {
            const statement = sqlite.prepare(query);
            let values = [];
            return {
                bind(...params) { values = params; return this; },
                async raw() { statement.setReturnArrays(true); return statement.all(...values); },
                async all() { return {results: statement.all(...values)}; },
            };
        },
    };
}

describe('通知邮件详情入口', () => {
    let sqlite;
    let env;
    let token;

    beforeEach(async () => {
        sqlite = new DatabaseSync(':memory:');
        for (const table of [email, att, star]) {
            const columns = Object.values(getTableColumns(table)).map(column =>
                `${column.name} ${column.dataType === 'number' ? 'INTEGER' : 'TEXT'}${column.primary ? ' PRIMARY KEY' : ''}`);
            sqlite.exec(`CREATE TABLE ${getTableName(table)} (${columns.join(', ')})`);
        }
        sqlite.prepare('INSERT INTO email (email_id, user_id, account_id, subject, text, recipient, is_del, unread) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(42, 7, 3, '通知邮件', '通知正文', '[]', 0, 0);
        sqlite.prepare('INSERT INTO email (email_id, user_id, is_del) VALUES (?, ?, ?)').run(43, 8, 0);
        sqlite.prepare('INSERT INTO email (email_id, user_id, is_del) VALUES (?, ?, ?)').run(44, 7, 1);
        sqlite.prepare('INSERT INTO star (star_id, email_id, user_id) VALUES (?, ?, ?)').run(1, 42, 7);
        sqlite.prepare('INSERT INTO attachments (att_id, email_id, user_id, type, filename) VALUES (?, ?, ?, ?, ?)')
            .run(1, 42, 7, 0, '通知附件.txt');
        const authInfo = {tokens: ['test-session'], user: {userId: 7, email: 'user@example.com'}, refreshTime: new Date().toISOString()};
        env = {
            db: createD1(sqlite), jwt_secret: 'test-secret', admin: 'admin@example.com',
            kv: {get: vi.fn(async key => key === kvConst.AUTH_INFO + 7 ? authInfo : null)},
        };
        token = await jwtUtils.generateToken({env}, {userId: 7, token: 'test-session'});
        vi.spyOn(permService, 'userPermKeys').mockResolvedValue([]);
    });

    afterEach(() => {
        sqlite.close();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    async function detail(emailId, authorization = token) {
        const response = await worker.fetch(new Request(`https://mail.example.com/api/email/detail?emailId=${emailId}`, {
            headers: authorization ? {Authorization: authorization} : {},
        }), env, {});
        return response.json();
    }

    it('Telegram 按钮 ID 可通过生产入口取回同一封邮件、正文、附件和星标', async () => {
        vi.spyOn(settingService, 'query').mockResolvedValue({tgBotToken: 'test-bot', tgChatId: 'test-chat', customDomain: 'mail.example.com'});
        const send = vi.fn().mockResolvedValue({ok: true});
        vi.stubGlobal('fetch', send);
        await telegramService.sendEmailToBot({env}, {emailId: 42, subject: '通知邮件', text: '通知正文'});
        const payload = JSON.parse(send.mock.calls[0][1].body);
        const buttons = payload.reply_markup.inline_keyboard.flat();
        const url = new URL(buttons.find(button => button.text.includes('Open in Mail')).url);
        expect(url.pathname).toBe('/mail');
        expect(url.searchParams.get('id')).toBe('42');
        const result = await detail(url.searchParams.get('id'));
        expect(result.code).toBe(200);
        expect(result.data).toMatchObject({emailId: 42, subject: '通知邮件', text: '通知正文', isStar: 1, attList: [{filename: '通知附件.txt'}]});
    });

    it('未登录时不能读取邮件详情', async () => {
        expect(await detail(42, '')).toMatchObject({code: 401});
    });

    it.each([43, 44, 999])('普通用户不能读取他人、已删除或不存在的邮件 %i', async emailId => {
        expect(await detail(emailId)).toMatchObject({code: 404});
    });

    it.each(['0', '-1', '42.5', 'NaN'])('非法邮件 ID %s 返回明确错误', async emailId => {
        expect(await detail(emailId)).toMatchObject({code: 400});
    });

    it('管理员可打开其他用户的通知邮件', async () => {
        env.admin = 'user@example.com';
        expect(await detail(43)).toMatchObject({code: 200, data: {emailId: 43, userId: 8}});
    });

    it('已有全部邮件查看权限的用户可打开其他用户的通知邮件', async () => {
        permService.userPermKeys.mockResolvedValue(['all-email:query']);
        expect(await detail(43)).toMatchObject({code: 200, data: {emailId: 43, userId: 8}});
    });
});
