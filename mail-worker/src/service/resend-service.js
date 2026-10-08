import emailService from './email-service';
import { emailConst } from '../const/entity-const';
import BizError from '../error/biz-error';
import { verifySvixSignature } from '../utils/svix-utils';

// Resend 支持的邮件事件白名单：未知类型直接 ack，不做任何 DB 写入。
const eventStatus = {
	'email.delivered': emailConst.status.DELIVERED,
	'email.complained': emailConst.status.COMPLAINED,
	'email.bounced': emailConst.status.BOUNCED,
	'email.delivery_delayed': emailConst.status.DELAYED,
	'email.failed': emailConst.status.FAILED,
};

const resendService = {

	// rawBody 是未经解析的原始请求文本，Svix 签名基于它计算，必须与签名校验前的字节完全一致。
	async webhooks(c, rawBody) {

		const secret = c.env?.resend_webhook_secret;
		if (!secret) {
			throw new BizError('Unauthorized', 401);
		}

		const verified = await verifySvixSignature({
			secret,
			headers: {
				'svix-id': c.req.header('svix-id') || '',
				'svix-timestamp': c.req.header('svix-timestamp') || '',
				'svix-signature': c.req.header('svix-signature') || '',
			},
			payload: rawBody,
		});

		if (!verified) {
			throw new BizError('Unauthorized', 401);
		}

		// 验签通过后才解析业务字段
		let body = null;
		try {
			body = rawBody ? JSON.parse(rawBody) : null;
		} catch {
			throw new BizError('Invalid payload', 400);
		}

		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			throw new BizError('Invalid payload', 400);
		}

		if (!Object.hasOwn(eventStatus, body.type)) {
			return;
		}

		const emailId = body.data?.email_id;
		if (typeof emailId !== 'string' || !emailId.trim() || emailId.length > 128) {
			throw new BizError('Invalid payload', 400);
		}

		const params = {
			resendEmailId: emailId,
			status: eventStatus[body.type],
			message: null,
		};

		// message 的形状沿用既有约定：bounced 存 JSON（前端 JSON.parse 后取 message），failed 存原文
		if (body.type === 'email.bounced') {
			params.message = JSON.stringify(body.data.bounce);
		}

		if (body.type === 'email.failed') {
			params.message = body.data.failed?.reason ?? null;
		}

		const emailRow = await emailService.updateEmailStatus(c, params);

		// 无匹配行也 ack：避免 Resend 重试风暴，同时消除“存在返回成功、不存在返回错误”的存在性 oracle。
		if (!emailRow) {
			console.warn('Resend webhook: no matching email, ack without update');
		}
	}
}

export default resendService
