import BizError from '../error/biz-error';
import userService from './user-service';
import emailUtils from '../utils/email-utils';
import { isDel, settingConst, userConst } from '../const/entity-const';
import JwtUtils from '../utils/jwt-utils';
import { v4 as uuidv4 } from 'uuid';
import KvConst from '../const/kv-const';
import constant from '../const/constant';
import userContext from '../security/user-context';
import verifyUtils from '../utils/verify-utils';
import accountService from './account-service';
import settingService from './setting-service';
import saltHashUtils from '../utils/crypto-utils';
import turnstileService from './turnstile-service';
import roleService from './role-service';
import regKeyService from './reg-key-service';
import dayjs from 'dayjs';
import { toUtc } from '../utils/date-uitil';
import { t } from '../i18n/i18n.js';
import verifyRecordService from './verify-record-service';

const loginService = {

	async register(c, params, oauthIdentity = null) {

		const { email, password, token, code } = params;

		let { regKey, register, registerVerify, regVerifyCount, minEmailPrefix, emailPrefixFilter } = await settingService.query(c)

		if (oauthIdentity) {
			registerVerify = settingConst.registerVerify.CLOSE;
			register = settingConst.register.OPEN;
		}

		if (register === settingConst.register.CLOSE) {
			throw new BizError(t('regDisabled'));
		}

		if (!verifyUtils.isEmail(email)) {
			throw new BizError(t('notEmail'));
		}

		// 加号别名只能经登录后的添加邮箱流程验证主地址归属。
		if (emailUtils.getName(email).includes('+')) {
			throw new BizError(t('aliasRegisterForbidden'), 403);
		}

		if (emailUtils.getName(email).length < minEmailPrefix) {
			throw new BizError(t('minEmailPrefix', { msg: minEmailPrefix } ));
		}

		if (emailPrefixFilter.some(content => emailUtils.getName(email).includes(content)))  {
			throw new BizError(t('banEmailPrefix'));
		}

		if (emailUtils.getName(email).length > 64) {
			throw new BizError(t('emailLengthLimit'));
		}

		if (password.length > 30) {
			throw new BizError(t('pwdLengthLimit'));
		}

		if (password.length < 6) {
			throw new BizError(t('pwdMinLength'));
		}

		if (!c.env.domain.includes(emailUtils.getDomain(email))) {
			throw new BizError(t('notEmailDomain'));
		}

		let type = null;
		let regKeyId = 0

		if (regKey === settingConst.regKey.OPEN) {
			const result = await this.handleOpenRegKey(c, regKey, code)
			type = result?.type
			regKeyId = result?.regKeyId
		}

		if (regKey === settingConst.regKey.OPTIONAL) {
			const result = await this.handleOpenOptional(c, regKey, code)
			type = result?.type
			regKeyId = result?.regKeyId ?? 0
		}

		const accountRow = await accountService.selectByEmailIncludeDel(c, email);

		if (accountRow && accountRow.isDel === isDel.DELETE) {
			throw new BizError(t('isDelUser'));
		}

		if (accountRow) {
			throw new BizError(t('isRegAccount'));
		}

		let defType = null

		if (!type) {
			const roleRow = await roleService.selectDefaultRole(c);
			defType = roleRow.roleId
		}


		const roleRow = await roleService.selectById(c, type || defType);

		if(!roleService.hasAvailDomainPerm(roleRow.availDomain, email)) {

			if (type) {
				throw new BizError(t('noDomainPermRegKey'),403)
			}

			if (defType) {
				throw new BizError(t('noDomainPermReg'),403)
			}

		}

		let regVerifyOpen = false

		if (registerVerify === settingConst.registerVerify.OPEN) {
			regVerifyOpen = true
			await turnstileService.verify(c,token)
		}

		if (registerVerify === settingConst.registerVerify.COUNT) {
			regVerifyOpen = await verifyRecordService.isOpenRegVerify(c, regVerifyCount);
			if (regVerifyOpen) {
				await turnstileService.verify(c,token)
			}
		}

		const { salt, hash } = await saltHashUtils.hashPassword(password);

		const userData = { email, regKeyId, password: hash, salt, type: type || defType };
		const userId = await this.registerAccount(c, {...userData, oauthId: oauthIdentity?.oauthId});

		await userService.updateUserInfo(c, userId, true);

		if (registerVerify === settingConst.registerVerify.COUNT && !regVerifyOpen) {
			const row = await verifyRecordService.increaseRegCount(c);
			return {regVerifyOpen: row.count >= regVerifyCount}
		}

		return {regVerifyOpen}

	},

	async registerAccount(c, {email, password, salt, type, regKeyId, oauthId}) {
		const conditions = [];
		const conditionValues = [];
		if (oauthId) {
			conditions.push('EXISTS (SELECT 1 FROM oauth WHERE oauth_id = ? AND user_id = 0)');
			conditionValues.push(oauthId);
		}
		if (regKeyId) {
			conditions.push("EXISTS (SELECT 1 FROM reg_key WHERE rege_key_id = ? AND role_id = ? AND count > 0 AND date(expire_time, '+8 hours') >= ?)");
			conditionValues.push(regKeyId, type, toUtc().tz('Asia/Shanghai').format('YYYY-MM-DD'));
		}
		// 后续写入只引用本批新建的凭据，资格失效时整批不产生账号或扣减。
		const createdUser = 'email = ? AND password = ? AND salt = ?';
		const credentials = [email, password, salt];
		const statements = [
			c.env.db.prepare(`INSERT INTO user (email, password, salt, type, reg_key_id)
				SELECT ?, ?, ?, ?, ? WHERE ${conditions.join(' AND ') || '1 = 1'}
				RETURNING user_id`).bind(email, password, salt, type, regKeyId, ...conditionValues),
			c.env.db.prepare(`INSERT INTO account (email, name, user_id)
				SELECT email, ?, user_id FROM user WHERE ${createdUser}`)
				.bind(emailUtils.getName(email), ...credentials)
		];
		if (oauthId) {
			statements.push(c.env.db.prepare(`UPDATE oauth SET user_id = (SELECT user_id FROM user WHERE email = ?)
				WHERE oauth_id = ? AND user_id = 0 AND EXISTS (SELECT 1 FROM user WHERE ${createdUser})`)
				.bind(email, oauthId, ...credentials));
		}
		if (regKeyId) {
			statements.push(c.env.db.prepare(`UPDATE reg_key SET count = count - 1 WHERE rege_key_id = ? AND count > 0
				AND EXISTS (SELECT 1 FROM user WHERE ${createdUser})`).bind(regKeyId, ...credentials));
		}
		// D1 batch 按顺序原子执行，任何写入失败都会回滚用户、邮箱、绑定与名额。
		const [created] = await c.env.db.batch(statements);
		const userId = created.results[0]?.user_id;
		if (!userId) throw new BizError('注册条件已失效，请重试', 409);
		return userId;
	},

	async registerVerify() {

	},

	async handleOpenRegKey(c, regKey, code) {

		if (!code) {
			throw new BizError(t('emptyRegKey'));
		}

		const regKeyRow = await regKeyService.selectByCode(c, code);

		if (!regKeyRow) {
			throw new BizError(t('notExistRegKey'));
		}

		if (regKeyRow.count <= 0) {
			throw new BizError(t('noRegKeyCount'));
		}

		const today = toUtc().tz('Asia/Shanghai').startOf('day')
		const expireTime = toUtc(regKeyRow.expireTime).tz('Asia/Shanghai').startOf('day');

		if (expireTime.isBefore(today)) {
			throw new BizError(t('regKeyExpire'));
		}

		return { type: regKeyRow.roleId, regKeyId: regKeyRow.regKeyId };
	},

	async handleOpenOptional(c, regKey, code) {

		if (!code) {
			return null
		}

		const regKeyRow = await regKeyService.selectByCode(c, code);

		if (!regKeyRow) {
			return null
		}

		const today = toUtc().tz('Asia/Shanghai').startOf('day')
		const expireTime = toUtc(regKeyRow.expireTime).tz('Asia/Shanghai').startOf('day');

		if (regKeyRow.count <= 0 || expireTime.isBefore(today)) {
			return null
		}

		return { type: regKeyRow.roleId, regKeyId: regKeyRow.regKeyId };
	},

	async login(c, params, noVerifyPwd = false) {

		const { email, password, token } = params;

		if ((!email || !password) && !noVerifyPwd) {
			throw new BizError(t('emailAndPwdEmpty'));
		}

		if (!noVerifyPwd) {
			const setting = await settingService.query(c);
			if (setting.siteKey && setting.secretKey) {
				await turnstileService.verify(c, token, {
					action: 'login', hostname: new URL(c.req.url).hostname
				});
			}
		}

		const userRow = await userService.selectByEmailIncludeDel(c, email);

		if (!userRow) {
			throw new BizError(t('notExistUser'));
		}

		if(userRow.isDel === isDel.DELETE) {
			throw new BizError(t('isDelUser'));
		}

		if(userRow.status === userConst.status.BAN) {
			throw new BizError(t('isBanUser'));
		}

		if (!noVerifyPwd && !await userService.verifyPassword(c, userRow, password)) {
			throw new BizError(t('IncorrectPwd'));
		}

		const uuid = uuidv4();
		const jwt = await JwtUtils.generateToken(c,{ userId: userRow.userId, token: uuid });

		let authInfo = await c.env.kv.get(KvConst.AUTH_INFO + userRow.userId, { type: 'json' });

		if (authInfo && (authInfo.user.email === userRow.email)) {

			if (authInfo.tokens.length > 10) {
				authInfo.tokens.shift();
			}

			authInfo.tokens.push(uuid);

		} else {

			authInfo = {
				tokens: [],
				user: userRow,
				refreshTime: dayjs().toISOString()
			};

			authInfo.tokens.push(uuid);

		}

		await userService.updateUserInfo(c, userRow.userId);

		authInfo.refreshTime = dayjs().toISOString();
		await c.env.kv.put(KvConst.AUTH_INFO + userRow.userId, JSON.stringify(authInfo), { expirationTtl: constant.TOKEN_EXPIRE });
		return jwt;
	},

	async logout(c, userId) {
		const token = await userContext.getToken(c);
		const key = KvConst.AUTH_INFO + userId;
		const authInfo = await c.env.kv.get(key, { type: 'json' });
		if (!authInfo) throw new BizError(t('authExpired'), 401);
		const index = authInfo.tokens.findIndex(item => item === token);
		if (index === -1) throw new BizError(t('authExpired'), 401);
		authInfo.tokens.splice(index, 1);
		// 退出不能把剩余会话变成永久记录，也不延长已有过期时间。
		const expiration = Math.floor(Date.parse(authInfo.refreshTime) / 1000) + constant.TOKEN_EXPIRE;
		if (authInfo.tokens.length === 0 || expiration <= Math.floor(Date.now() / 1000)) {
			await c.env.kv.delete(key);
			return;
		}
		await c.env.kv.put(key, JSON.stringify(authInfo), {expiration});
	}

};

export default loginService;
