import app from '../hono/hono';
import emailService from '../service/email-service';
import result from '../model/result';
import userContext from '../security/user-context';
import attService from '../service/att-service';
import settingService from '../service/setting-service';
import domainUtils from '../utils/domain-uitls';
import {createProxiedContent, proxyResource} from '../service/resource-proxy-service';

app.get('/email/resource/:token', c => proxyResource(c, c.req.param('token')));

app.post('/email/remote-content', async c => {
	const row = await emailService.detail(c, await c.req.json(), userContext.getUserId(c));
	const {r2Domain} = await settingService.query(c);
	const domain = domainUtils.toOssDomain(r2Domain);
	const content = await createProxiedContent(c, (row.content || '').replace(/{{domain}}/g, (domain || '') + '/'), {
		baseUrl: new URL(c.req.url).origin + '/', allowedOrigins: domain ? [domain] : [],
	});
	c.header('Cache-Control', 'private, no-store');
	return c.json(result.ok({content}));
});

app.get('/email/list', async (c) => {
	const data = await emailService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.get('/email/detail', async (c) => {
	const data = await emailService.detail(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.get('/email/latest', async (c) => {
	const list = await emailService.latest(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(list));
});

app.delete('/email/delete', async (c) => {
	await emailService.delete(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.get('/email/attList', async (c) => {
	const attList = await attService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(attList));
});

app.post('/email/send', async (c) => {
	const email = await emailService.send(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(email));
});

app.put('/email/read', async (c) => {
	await emailService.read(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
})

app.put('/email/unread', async (c) => {
	await emailService.unread(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
})
