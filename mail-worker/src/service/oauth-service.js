import BizError from "../error/biz-error";
import orm from "../entity/orm";
import {oauth} from "../entity/oauth";
import { and, eq, inArray } from 'drizzle-orm';
import userService from "./user-service";
import loginService from "./login-service";
import cryptoUtils from "../utils/crypto-utils";
import settingService from "./setting-service";
import pocketIdService from './pocket-id-service';
import {t} from '../i18n/i18n';
import jwtUtils from '../utils/jwt-utils';

// 未绑定身份的证明只用于十分钟内创建邮箱，不可作为登录会话。
const BINDING_TTL_SECONDS = 600;

const oauthService = {

	async pocketIdAuthorization(c, params, userId = 0) {
		return pocketIdService.createAuthorization(c, params.redirectUri, userId);
	},

	async pocketIdLogin(c, params, browserState) {
		const identity = await pocketIdService.exchangeCode(c, params, browserState);
		const userInfo = {
			oauthUserId: identity.sub,
			username: identity.username,
			name: identity.name,
			avatar: identity.avatar,
			platform: 'pocketid'
		};
		let oauthRow = await this.getByIdentity(c, userInfo.platform, userInfo.oauthUserId);

		if (oauthRow) {
			await orm(c).update(oauth).set(userInfo).where(and(
				eq(oauth.platform, userInfo.platform),
				eq(oauth.oauthUserId, userInfo.oauthUserId)
			)).run();
			oauthRow = { ...oauthRow, ...userInfo };
		} else {
			oauthRow = await orm(c).insert(oauth).values(userInfo).returning().get();
		}

		let userRow;
		if (identity.userId) {
			userRow = await userService.selectByIdIncludeDel(c, identity.userId);
			if (!userRow || userRow.email !== c.env.admin) {
				throw new BizError('只有管理员可以绑定 Pocket ID', 403);
			}
			if (oauthRow.userId && oauthRow.userId !== identity.userId) {
				throw new BizError('该 Pocket ID 已绑定其他账号');
			}
			await orm(c).update(oauth).set({ userId: identity.userId }).where(and(
				eq(oauth.platform, userInfo.platform),
				eq(oauth.oauthUserId, userInfo.oauthUserId)
			)).run();
		} else {
			userRow = await userService.selectByIdIncludeDel(c, oauthRow.userId);
			if (!userRow) {
				throw new BizError('请先使用管理员密码绑定 Pocket ID', 403);
			}
			if (userRow.email !== c.env.admin) {
				throw new BizError('Pocket ID 未绑定管理员账号', 403);
			}
		}

		const token = await loginService.login(c, { email: userRow.email, password: null }, true);
		return { userInfo: oauthRow, token };
	},

	async bindUser(c, params) {

		const { email, bindingToken, code } = params;
		const identity = await jwtUtils.verifyToken(c, bindingToken);
		const now = Math.floor(Date.now() / 1000);
		if (!identity || identity.purpose !== 'oauth-bind' ||
			!Number.isInteger(identity.iat) || !Number.isInteger(identity.exp) ||
			now >= identity.exp || identity.exp > identity.iat + BINDING_TTL_SECONDS ||
			!Number.isSafeInteger(identity.oauthId) || identity.oauthId <= 0 ||
			typeof identity.oauthUserId !== 'string' || !['linuxdo', 'github', 'google'].includes(identity.platform)) {
			throw new BizError('OAuth 绑定凭据无效', 401);
		}
		const switchKey = {linuxdo: 'linuxdoSwitch', github: 'githubSwitch', google: 'googleSwitch'}[identity.platform];
		this.assertEnabled(await settingService.query(c), switchKey);

		const oauthRow = await this.getByIdentity(c, identity.platform, identity.oauthUserId);
		if (!oauthRow || oauthRow.oauthId !== identity.oauthId) {
			throw new BizError('OAuth 绑定凭据无效', 401);
		}
		if (oauthRow.userId) {
			throw new BizError('OAuth 身份已绑定', 409);
		}

		// 身份来自已验证凭据；创建邮箱和消费绑定资格在同一 D1 原子批次完成。
		await loginService.register(c, { email, password: cryptoUtils.genRandomPwd(), code }, {oauthId: oauthRow.oauthId});
		const userRow = await userService.selectByEmail(c, email);

		const jwtToken = await loginService.login(c, { email, password: null }, true);

		return { userInfo: {...oauthRow, userId: userRow.userId}, token: jwtToken}
	},

	async linuxDoLogin(c, params) {

		const { code, redirectUri } = params;

		const setting = await settingService.query(c);
		this.assertEnabled(setting, 'linuxdoSwitch');

		const reqParams = new URLSearchParams()
		reqParams.append('client_id', setting.linuxdoClientId)
		reqParams.append('client_secret', setting.linuxdoClientSecret)
		reqParams.append('code', code)
		reqParams.append('redirect_uri', redirectUri)
		reqParams.append('grant_type', 'authorization_code')

		const tokenRes = await fetch("https://connect.linux.do/oauth2/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: reqParams.toString()
		})

		if (!tokenRes.ok) {
			throw new BizError(tokenRes.statusText)
		}

		const token = await tokenRes.json()

		const userRes = await fetch('https://connect.linux.do/api/user', {
			headers: {
				Authorization: 'Bearer ' + token.access_token
			}
		});

		if (!userRes.ok) {
			throw new BizError(userRes.statusText)
		}

		const userInfo = await userRes.json();

		userInfo.oauthUserId = String(userInfo.id);
		userInfo.active = userInfo.active ? 0 : 1;
		userInfo.silenced = userInfo.silenced ? 0 : 1;
		userInfo.trustLevel = userInfo.trust_level;
		userInfo.avatar = userInfo.avatar_url;
		userInfo.platform = 'linuxdo';

		return await this.saveAndLogin(c, userInfo)
	},

	async githubLogin(c, params) {

		const { code, redirectUri } = params;

		const setting = await settingService.query(c);
		this.assertEnabled(setting, 'githubSwitch');

		const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Accept": "application/json"
			},
			body: JSON.stringify({
				client_id: setting.githubClientId,
				client_secret: setting.githubClientSecret,
				code: code,
				redirect_uri: redirectUri
			})
		});

		if (!tokenRes.ok) {
			throw new BizError(tokenRes.statusText);
		}

		const token = await tokenRes.json();

		if (token.error) {
			throw new BizError(token.error_description || token.error);
		}

		const userRes = await fetch('https://api.github.com/user', {
			headers: {
				Authorization: 'Bearer ' + token.access_token,
				'User-Agent': 'cloud-mail'
			}
		});

		if (!userRes.ok) {
			throw new BizError(userRes.statusText);
		}

		const userInfo = await userRes.json();

		userInfo.oauthUserId = String(userInfo.id);
		userInfo.username = userInfo.login;
		userInfo.avatar = userInfo.avatar_url;
		userInfo.platform = 'github';

		return await this.saveAndLogin(c, userInfo);
	},

	async googleLogin(c, params) {

		const { code, redirectUri } = params;

		const setting = await settingService.query(c);
		this.assertEnabled(setting, 'googleSwitch');

		const reqParams = new URLSearchParams()
		reqParams.append('client_id', setting.googleClientId)
		reqParams.append('client_secret', setting.googleClientSecret)
		reqParams.append('code', code)
		reqParams.append('redirect_uri', redirectUri)
		reqParams.append('grant_type', 'authorization_code')

		const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: reqParams.toString()
		});

		if (!tokenRes.ok) {
			throw new BizError(tokenRes.statusText);
		}

		const token = await tokenRes.json();

		const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
			headers: {
				Authorization: 'Bearer ' + token.access_token
			}
		});

		if (!userRes.ok) {
			throw new BizError(userRes.statusText);
		}

		const userInfo = await userRes.json();

		userInfo.oauthUserId = String(userInfo.sub);
		userInfo.username = userInfo.email;
		userInfo.name = userInfo.name;
		userInfo.avatar = userInfo.picture;
		userInfo.platform = 'google';

		return await this.saveAndLogin(c, userInfo);
	},

	async saveAndLogin(c, userInfo) {

		const oauthRow = await this.saveUser(c, userInfo);
		const userRow = await userService.selectByIdIncludeDel(c, oauthRow.userId);

		if (!userRow) {
			const bindingToken = await jwtUtils.generateToken(c, {
				purpose: 'oauth-bind', oauthId: oauthRow.oauthId,
				platform: oauthRow.platform, oauthUserId: oauthRow.oauthUserId
			}, BINDING_TTL_SECONDS);
			return { userInfo: oauthRow, token: null, bindingToken };
		}

		const JwtToken = await loginService.login(c, { email: userRow.email, password: null }, true);
		return { userInfo: oauthRow, token: JwtToken };
	},

	async saveUser(c, userInfo) {

		// 不同提供方的同号 subject 不是同一个身份。
		const userInfoRow = await this.getByIdentity(c, userInfo.platform, userInfo.oauthUserId);

		if (!userInfoRow) {
			return await orm(c).insert(oauth).values(userInfo).returning().get();
		} else {
			return await orm(c).update(oauth).set(userInfo).where(eq(oauth.oauthId, userInfoRow.oauthId)).returning().get();
		}

	},

	assertEnabled(setting, switchKey) {
		if (setting[switchKey] !== 0) {
			throw new BizError(t('oauthDisabled'));
		}
	},

	async getByIdentity(c, platform, oauthUserId) {
		return await orm(c).select().from(oauth).where(and(
			eq(oauth.platform, platform),
			eq(oauth.oauthUserId, oauthUserId)
		)).get();
	},

	async deleteByUserId(c, userId) {
		await this.deleteByUserIds(c, [userId]);
	},

	async deleteByUserIds(c, userIds) {
		await orm(c).delete(oauth).where(inArray(oauth.userId, userIds)).run();
	},

	//定时任务凌晨清除未绑定邮箱的oauth用户
	async clearNoBindOathUser(c) {
		await orm(c).delete(oauth).where(eq(oauth.userId, 0)).run();
	},

}

export default  oauthService
