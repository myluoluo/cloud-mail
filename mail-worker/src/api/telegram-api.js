import app from '../hono/hono';
import telegramService from '../service/telegram-service';
import result from '../model/result';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

app.get('/telegram/getEmail/:token', async (c) => {
	const content = await telegramService.getEmailContent(c, c.req.param());
	c.header('Cache-Control', 'private, no-store');
	return c.html(content)
});

app.post('/telegram/webhook', async (c) => {
	return await telegramService.handleWebhook(c);
});

const checkTelegramAdmin = (c) => {
	// 使用全局中间件验证过的会话，禁止预览 JWT 或签名密钥充当管理员身份。
	const user = c.get('user');
	if (!user || user.email !== c.env.admin) {
		throw new BizError(t('unauthorized'), 403);
	}
};

app.all('/telegram/setupWebhook', async (c) => {
	checkTelegramAdmin(c);
	const data = await telegramService.setupWebhook(c);
	return c.json(result.ok(data));
});

app.all('/telegram/setWebhook', async (c) => {
	checkTelegramAdmin(c);
	const data = await telegramService.setupWebhook(c);
	return c.json(result.ok(data));
});

app.all('/telegram/webhookInfo', async (c) => {
	checkTelegramAdmin(c);
	const data = await telegramService.getWebhookInfo(c);
	return c.json(result.ok(data));
});
