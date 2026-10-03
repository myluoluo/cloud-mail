import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteObjects } = vi.hoisted(() => ({ deleteObjects: vi.fn() }));
vi.mock('../src/service/r2-service', () => ({ default: { delete: deleteObjects } }));

const { default: emailService } = await import('../src/service/email-service');

// SQL 使用真实 SQLite 执行；适配 D1 接口并施加其每条查询 100 个绑定参数的限制。
function createD1(sqlite) {
	return {
		prepare(query) {
			const statement = sqlite.prepare(query);
			let values = [];
			return {
				bind(...params) {
					if (params.length > 100) throw new Error('D1_ERROR: too many SQL variables');
					values = params;
					return this;
				},
				async raw() {
					statement.setReturnArrays(true);
					return statement.all(...values);
				},
				async all() {
					return { success: true, results: statement.all(...values), meta: {} };
				},
				async run() {
					const result = statement.run(...values);
					return { success: true, results: [], meta: { changes: Number(result.changes) } };
				}
			};
		},
		async batch(statements) {
			sqlite.exec('BEGIN');
			try {
				const results = await Promise.all(statements.map(statement => statement.all()));
				sqlite.exec('COMMIT');
				return results;
			} catch (error) {
				sqlite.exec('ROLLBACK');
				throw error;
			}
		}
	};
}

describe('管理员邮件批量清除', () => {
	let sqlite;
	let c;

	beforeEach(() => {
		vi.clearAllMocks();
		sqlite = new DatabaseSync(':memory:');
		sqlite.exec(`
			CREATE TABLE email (
				email_id INTEGER PRIMARY KEY, name TEXT, send_email TEXT, to_email TEXT,
				subject TEXT, create_time TEXT, status INTEGER
			);
			CREATE TABLE star (star_id INTEGER PRIMARY KEY, email_id INTEGER);
			CREATE TABLE attachments (att_id INTEGER PRIMARY KEY, email_id INTEGER, key TEXT);
		`);
		c = { env: { db: createD1(sqlite) } };
	});

	afterEach(() => sqlite.close());

	function addEmail(emailId, { sender = '目标发件人', status = 0 } = {}) {
		sqlite.prepare('INSERT INTO email (email_id, name, status) VALUES (?, ?, ?)')
			.run(emailId, sender, status);
		sqlite.prepare('INSERT INTO star (email_id) VALUES (?)').run(emailId);
		sqlite.prepare('INSERT INTO attachments (email_id, key) VALUES (?, ?)')
			.run(emailId, `attachment-${emailId}`);
	}

	it.each([0, 1, 100, 101, 205])('只填发件人清除 %i 封匹配邮件，保留无关及正在保存的邮件', async (total) => {
		for (let emailId = 1; emailId <= total; emailId++) addEmail(emailId);
		addEmail(10001, { sender: '其他发件人' });
		addEmail(10002, { status: 6 });

		await expect(emailService.batchDelete(c, { sendName: '目标发件人' }))
			.resolves.toEqual({ matchedCount: total, deletedCount: total });

		expect(sqlite.prepare('SELECT email_id FROM email ORDER BY email_id').all())
			.toEqual([{ email_id: 10001 }, { email_id: 10002 }]);
		expect(sqlite.prepare('SELECT email_id FROM star ORDER BY email_id').all())
			.toEqual([{ email_id: 10001 }, { email_id: 10002 }]);
		expect(sqlite.prepare('SELECT email_id FROM attachments ORDER BY email_id').all())
			.toEqual([{ email_id: 10001 }, { email_id: 10002 }]);
		expect(deleteObjects.mock.calls.flatMap(([, keys]) => keys).sort())
			.toEqual(Array.from({ length: total }, (_, index) => `attachment-${index + 1}`).sort());
	});

	it('没有筛选条件时不清除任何邮件', async () => {
		addEmail(1);

		await expect(emailService.batchDelete(c, {}))
			.resolves.toEqual({ matchedCount: 0, deletedCount: 0 });

		expect(sqlite.prepare('SELECT COUNT(*) AS total FROM email').get().total).toBe(1);
		expect(sqlite.prepare('SELECT COUNT(*) AS total FROM star').get().total).toBe(1);
		expect(sqlite.prepare('SELECT COUNT(*) AS total FROM attachments').get().total).toBe(1);
		expect(deleteObjects).not.toHaveBeenCalled();
	});
});
