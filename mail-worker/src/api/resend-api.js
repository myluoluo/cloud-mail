import resendService from '../service/resend-service';
import app from '../hono/hono';
app.post('/webhooks',async (c) => {
	try {
		// 必须传原始文本：JSON 往返会改变空白/字段顺序，导致 Svix 签名对不上。
		await resendService.webhooks(c, await c.req.text());
		return c.text('success', 200)
	} catch (e) {
		if (e.code === 401) {
			return c.text('Unauthorized', 401)
		}
		if (e.code === 400) {
			return c.text('Invalid payload', 400)
		}
		// 内部错误不再回显原文，避免泄露实现细节
		console.error('Resend webhook failed:', e.message);
		return c.text('Webhook processing failed', 500)
	}
})
