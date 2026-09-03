import app from '../hono/hono';
import result from "../model/result";
import oauthService from "../service/oauth-service";
import userContext from '../security/user-context';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

const POCKET_ID_STATE_COOKIE = 'pocket_id_oauth_state';

function setPocketIdStateCookie(c, state) {
	setCookie(c, POCKET_ID_STATE_COOKIE, state, {
		httpOnly: true,
		secure: new URL(c.req.url).protocol === 'https:',
		sameSite: 'Lax',
		path: '/',
		maxAge: 600
	});
}

app.get('/oauth/pocketId/authorize', async (c) => {
	const authorization = await oauthService.pocketIdAuthorization(c, c.req.query());
	setPocketIdStateCookie(c, authorization.state);
	return c.json(result.ok({ url: authorization.url }));
});

app.get('/my/pocketId/authorize', async (c) => {
	const user = userContext.getUser(c);
	if (user.email !== c.env.admin) {
		return c.json(result.fail('只有管理员可以绑定 Pocket ID', 403));
	}
	const authorization = await oauthService.pocketIdAuthorization(c, c.req.query(), user.userId);
	setPocketIdStateCookie(c, authorization.state);
	return c.json(result.ok({ url: authorization.url }));
});

app.post('/oauth/pocketId/login', async (c) => {
	const loginInfo = await oauthService.pocketIdLogin(
		c,
		await c.req.json(),
		getCookie(c, POCKET_ID_STATE_COOKIE)
	);
	deleteCookie(c, POCKET_ID_STATE_COOKIE, { path: '/' });
	return c.json(result.ok(loginInfo));
});

app.post('/oauth/linuxDo/login', async (c) => {
	const loginInfo = await oauthService.linuxDoLogin(c, await c.req.json());
	return c.json(result.ok(loginInfo))
});

app.post('/oauth/github/login', async (c) => {
	const loginInfo = await oauthService.githubLogin(c, await c.req.json());
	return c.json(result.ok(loginInfo))
});

app.post('/oauth/google/login', async (c) => {
	const loginInfo = await oauthService.googleLogin(c, await c.req.json());
	return c.json(result.ok(loginInfo))
});

app.put('/oauth/bindUser', async (c) => {
	const loginInfo = await oauthService.bindUser(c, await c.req.json());
	return c.json(result.ok(loginInfo))
})
