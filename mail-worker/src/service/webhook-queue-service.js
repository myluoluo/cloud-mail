import BizError from '../error/biz-error';
import { isHttpUrl } from '../utils/webhook-url';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const WEBHOOK_CHANNEL = 'webhook';
const WEBHOOK_VERSION = 1;
const MAIL_PAYLOAD_FIELDS = Object.freeze([
	'emailId',
	'sendEmail',
	'name',
	'accountId',
	'userId',
	'subject',
	'text',
	'content',
	'cc',
	'bcc',
	'recipient',
	'toEmail',
	'toName',
	'inReplyTo',
	'relation',
	'messageId',
	'type',
	'status',
	'resendEmailId',
	'message',
	'unread',
	'createTime',
]);
const ATTACHMENT_PAYLOAD_FIELDS = Object.freeze([
	'attId',
	'userId',
	'emailId',
	'accountId',
	'key',
	'filename',
	'mimeType',
	'size',
	'status',
	'type',
	'disposition',
	'related',
	'contentId',
	'encoding',
	'createTime',
]);

const webhookQueueService = {

	buildMessage({ emailId, webhookUrl, webhookSecret }) {
		return {
			version: WEBHOOK_VERSION,
			channel: WEBHOOK_CHANNEL,
			eventId: crypto.randomUUID(),
			emailId,
			createdAt: new Date().toISOString(),
			webhook: {
				url: webhookUrl,
				secret: webhookSecret
			}
		};
	},

	async buildWebhookRequest({ message, emailRow, attachments, sentAt = new Date().toISOString() }) {
		const payload = this.buildPayload(message.eventId, emailRow, attachments, sentAt);
		const body = JSON.stringify(payload);
		const signature = await this.signBody(body, message.webhook.secret);

		return {
			url: message.webhook.url,
			body,
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Event-Id': message.eventId,
				'X-Cloud-Mail-Signature': signature
			}
		};
	},

	buildPayload(eventId, emailRow, attachments, sentAt) {
		return {
			eventId,
			channel: WEBHOOK_CHANNEL,
			sentAt,
			mail: {
				...this.pickFields(emailRow, MAIL_PAYLOAD_FIELDS),
				attachments: attachments.map((item) => this.pickFields(item, ATTACHMENT_PAYLOAD_FIELDS)),
			}
		};
	},

	pickFields(source, fields) {
		return fields.reduce((result, field) => {
			if (source[field] !== undefined) {
				result[field] = source[field];
			}
			return result;
		}, {});
	},

	async signBody(body, secret) {
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			'raw',
			encoder.encode(secret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		const buffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
		return Array.from(new Uint8Array(buffer)).map(item => item.toString(16).padStart(2, '0')).join('');
	},

	async handleMessage(c, message, deps = {}) {
		const emailLookup = deps.emailLookup ?? (() => Promise.resolve(null));
		const attachmentLookup = deps.attachmentLookup ?? (() => Promise.resolve([]));
		const fetcher = deps.fetcher ?? fetch;

		try {
			this.validateMessage(message.body);
			const emailRow = await emailLookup(c, message.body.emailId);

			if (!emailRow) {
				console.error(`Webhook 通知邮件不存在 emailId=${message.body.emailId}`);
				message.ack();
				return;
			}

			const attachments = await attachmentLookup(c, message.body.emailId);
			const request = await this.buildWebhookRequest({
				message: message.body,
				emailRow,
				attachments,
			});

			const response = await fetcher(request.url, {
				method: 'POST',
				headers: request.headers,
				body: request.body,
			});

			if (response.ok) {
				message.ack();
				return;
			}

			if (RETRYABLE_STATUS.has(response.status)) {
				console.error(`Webhook 通知临时失败 status=${response.status} emailId=${message.body.emailId}`);
				message.retry();
				return;
			}

			console.error(`Webhook 通知永久失败 status=${response.status} emailId=${message.body.emailId} body=${await response.text()}`);
			message.ack();
		} catch (error) {
			if (this.isRetryableError(error)) {
				console.error(`Webhook 通知异常重试 emailId=${message.body?.emailId}:`, error.message);
				message.retry();
				return;
			}

			console.error(`Webhook 通知永久异常 emailId=${message.body?.emailId}:`, error.message);
			message.ack();
		}
	},

	validateMessage(body) {
		if (!body || body.channel !== WEBHOOK_CHANNEL) {
			throw new BizError('Invalid webhook queue message', 400);
		}

		if (!body.webhook?.url) {
			throw new BizError('Webhook URL is required', 400);
		}

		if (!body.webhook?.secret) {
			throw new BizError('Webhook secret is required', 400);
		}

		if (!isHttpUrl(body.webhook.url)) {
			throw new BizError('Webhook URL is invalid', 400);
		}
	},

	isRetryableError(error) {
		if (!error) {
			return false;
		}

		if (error.name === 'BizError') {
			return false;
		}

		return true;
	}
};

export default webhookQueueService;
