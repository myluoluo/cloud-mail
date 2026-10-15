import orm from '../entity/orm';
import email from '../entity/email';
import settingService from './setting-service';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);
import { eq } from 'drizzle-orm';
import jwtUtils from '../utils/jwt-utils';
import emailMsgTemplate from '../template/email-msg';
import emailTextTemplate from '../template/email-text';
import emailHtmlTemplate from '../template/email-html';
import domainUtils from "../utils/domain-uitls";

// Quick View 预览链接从签发起最多有效 3 天。
const EMAIL_PREVIEW_TTL_SECONDS = 3 * 24 * 60 * 60;

const telegramService = {

	async getEmailContent(c, params) {

		const { token } = params

		const result = await jwtUtils.verifyToken(c, token);
		const now = Math.floor(Date.now() / 1000);

		// 旧链接没有 exp，仍按签发时间执行相同的 3 天期限。
		if (!result || !Number.isInteger(result.iat) || now >= result.iat + EMAIL_PREVIEW_TTL_SECONDS) {
			return emailTextTemplate('Access denied')
		}

		const emailRow = await orm(c).select().from(email).where(eq(email.emailId, result.emailId)).get();

		if (emailRow) {

			if (emailRow.content) {
				const { r2Domain } = await settingService.query(c);
				return emailHtmlTemplate(emailRow.content || '', r2Domain)
			} else {
				return emailTextTemplate(emailRow.text || '')
			}

		} else {
			return emailTextTemplate('The email does not exist')
		}

	},

	async sendEmailToBot(c, email) {

		const { tgBotToken, tgChatId, customDomain, tgMsgTo, tgMsgFrom, tgMsgText } = await settingService.query(c);

		const tgChatIds = tgChatId.split(',');

		const jwtToken = await jwtUtils.generateToken(c, { emailId: email.emailId }, EMAIL_PREVIEW_TTL_SECONDS)

		const baseDomain = domainUtils.toOssDomain(customDomain) || new URL(c.req.url).origin;
		const webAppUrl = `${baseDomain}/api/telegram/getEmail/${jwtToken}`;
		const mailWebUrl = `${baseDomain}/mail?id=${email.emailId}`;

		const inlineKeyboard = [];

		if (email.code) {
			inlineKeyboard.push([
				{
					text: `📋 Copy ${email.code}`,
					copy_text: { text: email.code }
				}
			]);
		}

		inlineKeyboard.push([
			{
				text: '⚡ Quick View',
				web_app: { url: webAppUrl }
			},
			{
				text: '📬 Open in Mail',
				url: mailWebUrl
			}
		]);

		await Promise.all(tgChatIds.map(async chatId => {
			try {
				const res = await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						chat_id: chatId,
						parse_mode: 'HTML',
						text: emailMsgTemplate(email, tgMsgTo, tgMsgFrom, tgMsgText),
						reply_markup: {
							inline_keyboard: inlineKeyboard
						}
					})
				});
				if (!res.ok) {
					console.error(`转发 Telegram 失败 status: ${res.status} response: ${await res.text()}`);
				}
			} catch (e) {
				console.error(`转发 Telegram 失败:`, e.message);
			}
		}));

	}

}

export default telegramService
