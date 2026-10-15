import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwtUtils from '../src/utils/jwt-utils';
import { createProxiedContent, proxyResource } from '../src/service/resource-proxy-service';

let context;
let fetcher;

async function token(url, overrides = {}) {
    return jwtUtils.generateToken(context, { purpose: 'mail-resource', url, ...overrides }, 600);
}

describe('邮件远程资源匿名代理', () => {
    beforeEach(() => {
        context = { env: { jwt_secret: randomBytes(32).toString('hex') }, req: { url: 'https://mail.example.com/api/email/remote-content' } };
        fetcher = vi.fn(async input => {
            const url = new URL(input);
            if (url.hostname === 'cloudflare-dns.com') {
                return Response.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{type: 1, data: '93.184.216.34'}] : [] });
            }
            return new Response('image', {headers: {'Content-Type': 'image/png', 'Set-Cookie': 'remote=secret'}});
        });
    });
    afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers();});

    it('只给邮件中的远端引用签发短期代理 URL，签名覆盖目标且不包含查看凭据', async () => {
        const content = await createProxiedContent(context, '<img src="https://images.example.com/a.png"><style>@import "https://images.example.com/a.css";</style>', {baseUrl: 'https://mail.example.com/'});
        expect(content).not.toContain('https://images.example.com');
        const match = content.match(/https:\/\/mail.example.com\/api\/email\/resource\/([\w.-]+)/);
        const payload = await jwtUtils.verifyToken(context, match[1]);
        expect(payload).toMatchObject({purpose: 'mail-resource', url: 'https://images.example.com/a.png'});
        expect(payload.exp - payload.iat).toBe(600);
    });

    it('转义的 CSS 函数和导入也转换为代理地址，而非丢失正常样式', async () => {
        const content = await createProxiedContent(context, String.raw`<style>@\69mport "https://images.example.com/a.css";.a{background:u\72l(https://images.example.com/a.png);color:red}</style>`, {baseUrl: 'https://mail.example.com/'});
        expect(content.match(/\/api\/email\/resource\//g)).toHaveLength(2);
        expect(content).toContain('color:red');
        expect(content).not.toContain('images.example.com');
    });

    it('不转发访客身份、Cookie、Referer 或上游 Cookie，响应禁止缓存和活动内容', async () => {
        const response = await proxyResource(context, await token('https://images.example.com/a.png'), {fetcher});
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('image');
        expect(response.headers.get('Set-Cookie')).toBeNull();
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
        for (const [, options] of fetcher.mock.calls) {
            const headers = new Headers(options.headers);
            for (const name of ['authorization', 'cookie', 'referer', 'forwarded']) expect(headers.has(name)).toBe(false);
            expect(headers.get('cf-connecting-ip')).toBe('0.0.0.0');
            expect(headers.get('x-real-ip')).toBe('0.0.0.0');
            expect(headers.get('x-forwarded-for')).toBe('0.0.0.0');
            expect(headers.get('cf-connecting-ipv6')).toBe('::');
            expect(headers.get('true-client-ip')).toBe('0.0.0.0');
            expect(options.redirect).toBe('manual');
        }
    });

    it.each(['http://127.1/a', 'http://0x7f000001/a', 'http://[::ffff:127.0.0.1]/a', 'http://localhost/a', 'https://user:pass@images.example.com/a', 'file:///etc/passwd', 'https://images.example.com:8443/a', 'https://mail.example.com/api/init/a', 'https://mail.example.com./api/init/a'])('拒绝非公共目标 %s', async url => {
        const response = await proxyResource(context, await token(url), {fetcher});
        expect(response.status).toBe(403);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('无效签名、用途不符和过期凭据不访问网络', async () => {
        for (const value of ['invalid', await token('https://images.example.com/a', {purpose: 'email-preview'}), await jwtUtils.generateToken(context, {purpose: 'mail-resource', url: 'https://images.example.com/a', exp: 1})]) {
            expect((await proxyResource(context, value, {fetcher})).status).toBe(403);
        }
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('DNS 含私网地址时拒绝；重定向重新校验目标', async () => {
        fetcher.mockImplementation(async input => new URL(input).hostname === 'cloudflare-dns.com'
            ? Response.json({Status: 0, Answer: [{type: 1, data: '10.0.0.1'}]})
            : new Response(null, {status: 302, headers: {Location: 'http://169.254.169.254/latest/meta-data/'}}));
        expect((await proxyResource(context, await token('https://images.example.com/a'), {fetcher})).status).toBe(403);
        expect(fetcher.mock.calls.every(([url]) => new URL(url).hostname === 'cloudflare-dns.com')).toBe(true);
    });

    it('不会跟随私网重定向，公共重定向必须重新进行 DNS 校验', async () => {
        fetcher.mockImplementation(async input => new URL(input).hostname === 'cloudflare-dns.com'
            ? Response.json({Status: 0, Answer: [{type: 1, data: '93.184.216.34'}]})
            : new Response(null, {status: 302, headers: {Location: 'http://169.254.169.254/latest/meta-data/'}}));
        expect((await proxyResource(context, await token('https://images.example.com/a'), {fetcher})).status).toBe(403);
        expect(fetcher.mock.calls.some(([url]) => new URL(url).hostname === '169.254.169.254')).toBe(false);

        fetcher.mockClear();
        fetcher.mockImplementation(async input => {
            const url = new URL(input);
            if (url.hostname === 'cloudflare-dns.com') return Response.json({Status: 0, Answer: [{type: 1, data: url.searchParams.get('name') === 'private.example.com' ? '192.168.1.1' : '93.184.216.34'}]});
            return new Response(null, {status: 302, headers: {Location: 'https://private.example.com/a'}});
        });
        expect((await proxyResource(context, await token('https://images.example.com/a'), {fetcher})).status).toBe(403);
        expect(fetcher.mock.calls.some(([url]) => new URL(url).hostname === 'private.example.com')).toBe(false);
    });

    it('无 Content-Length 时也按实际读取大小限制响应', async () => {
        fetcher.mockImplementation(async input => new URL(input).hostname === 'cloudflare-dns.com'
            ? Response.json({Status: 0, Answer: [{type: 1, data: '93.184.216.34'}]})
            : new Response(new Uint8Array(10485761), {headers: {'Content-Type': 'image/png'}}));
        expect((await proxyResource(context, await token('https://images.example.com/a'), {fetcher})).status).toBe(413);
    });

    it('达到 15 秒网络期限后明确失败，不回退到浏览器直连', async () => {
        vi.useFakeTimers();
        const signed = await token('https://images.example.com/a');
        let started;
        const ready = new Promise(resolve => {started = resolve;});
        fetcher.mockImplementation((input, options) => new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            started();
        }));
        const response = proxyResource(context, signed, {fetcher});
        await ready;
        await vi.advanceTimersByTimeAsync(15000);
        expect((await response).status).toBe(504);
    });

    it('外部 CSS 的相对导入、图片与字体继续走代理', async () => {
        fetcher.mockImplementation(async input => new URL(input).hostname === 'cloudflare-dns.com'
            ? Response.json({Status: 0, Answer: [{type: 1, data: '93.184.216.34'}]})
            : new Response('@import "nested.css";@font-face{src:url(font.woff2)}p{background:url(../a.png)}', {headers: {'Content-Type': 'text/css'}}));
        const response = await proxyResource(context, await token('https://images.example.com/css/style.css'), {fetcher});
        const css = await response.text();
        expect(response.status).toBe(200);
        expect(css.match(/\/api\/email\/resource\//g)).toHaveLength(3);
        expect(css).not.toMatch(/nested\.css|font\.woff2|\.\.\/a\.png/);
    });

    it('CSS 子资源凭据不会延长上级期限', async () => {
        vi.useFakeTimers();
        const signed = await token('https://images.example.com/a.css');
        const original = await jwtUtils.verifyToken(context, signed);
        vi.setSystemTime(Date.now() + 590000);
        fetcher.mockImplementation(async input => new URL(input).hostname === 'cloudflare-dns.com'
            ? Response.json({Status: 0, Answer: [{type: 1, data: '93.184.216.34'}]})
            : new Response('p{background:url(a.png)}', {headers: {'Content-Type': 'text/css'}}));
        const css = await (await proxyResource(context, signed, {fetcher})).text();
        const child = await jwtUtils.verifyToken(context, css.match(/\/api\/email\/resource\/([\w.-]+)/)[1]);
        expect(child.exp).toBe(original.exp);
        expect(child.exp - child.iat).toBe(10);
    });

    it('不把 HTML 响应或超大响应返回给邮件页面', async () => {
        for (const headers of [{'Content-Type': 'text/html'}, {'Content-Type': 'image/png', 'Content-Length': '10485761'}, {'Content-Type': 'text/css', 'Content-Length': '524289'}]) {
            fetcher.mockImplementation(async input => new URL(input).hostname === 'cloudflare-dns.com'
                ? Response.json({Status: 0, Answer: [{type: 1, data: '93.184.216.34'}]})
                : new Response('body', {headers}));
            expect((await proxyResource(context, await token('https://images.example.com/a'), {fetcher})).status).toBeGreaterThanOrEqual(400);
        }
    });
});
