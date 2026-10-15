import * as cssTree from 'css-tree';
import parseSrcset from 'parse-srcset';
import ipaddr from 'ipaddr.js';
import jwtUtils from '../utils/jwt-utils';
import {parseMailDocument} from '../template/email-html';
import {resourcePolicy, rewriteCss, rewriteEmailResources} from '../../../shared/email-resources.js';

// 资源签名仅用于短时展示，不沿用登录或 Quick View 凭据。
export const RESOURCE_TTL_SECONDS = 10 * 60;
const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;
// CSS 会展开为语法树，内存开销明显高于二进制资源。
const MAX_CSS_BYTES = 512 * 1024;
const RESOURCE_TIMEOUT_MS = 15 * 1000;
const MAX_REDIRECTS = 5;
const RESPONSE_HEADERS = {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Access-Control-Allow-Origin': '*',
};

function anonymousHeaders(accept) {
    // Workers 会补充 IP 头；显式覆盖，连同跨区和非 Cloudflare 目标一起匿名化。
    return {
        'Accept': accept, 'Accept-Encoding': 'identity', 'User-Agent': 'Cloud-Mail-Resource-Proxy',
        'CF-Connecting-IP': '0.0.0.0', 'CF-Connecting-IPv6': '::', 'CF-Pseudo-IPv4': '0.0.0.0',
        'X-Real-IP': '0.0.0.0', 'X-Forwarded-For': '0.0.0.0', 'True-Client-IP': '0.0.0.0', 'CF-IPCountry': 'XX',
    };
}

function checkedTarget(value, ownOrigin) {
    let url;
    try { url = new URL(value); } catch { throw Object.assign(new Error('Invalid resource URL'), {status: 403}); }
    const hostname = url.hostname.replace(/\.$/, '');
    url.hostname = hostname;
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.origin === ownOrigin ||
        ipaddr.isValid(hostname) || hostname.startsWith('[') || !hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|lan|home|invalid)$/.test(hostname)) {
        throw Object.assign(new Error('Resource target is not public'), {status: 403});
    }
    url.hash = '';
    return url;
}

async function checkDns(url, {fetcher, signal}) {
    const results = await Promise.all(['A', 'AAAA'].map(async type => {
        const query = new URL('https://cloudflare-dns.com/dns-query');
        query.searchParams.set('name', url.hostname);
        query.searchParams.set('type', type);
        const response = await fetcher(query.href, {headers: anonymousHeaders('application/dns-json'), redirect: 'manual', signal});
        if (!response.ok) throw new Error('Resource DNS lookup failed');
        const data = await response.json();
        if (data.Status !== 0) throw Object.assign(new Error('Resource DNS lookup failed'), {status: 403});
        return (data.Answer || []).filter(answer => [1, 28].includes(answer.type)).map(answer => answer.data);
    }));
    const addresses = results.flat();
    if (!addresses.length || addresses.some(address => !ipaddr.isValid(address) || ipaddr.process(address).range() !== 'unicast')) {
        throw Object.assign(new Error('Resource DNS is not public'), {status: 403});
    }
    // 实际连接使用 Workers 公网 fetch，不能改为带内网绑定的 fetch 或通用 Node 代理。
}

async function proxyUrls(c, targets, expiresAt) {
    const remaining = expiresAt - Math.floor(Date.now() / 1000);
    if (remaining <= 0) throw Object.assign(new Error('Resource authorization expired'), {status: 403});
    const entries = await Promise.all([...targets].map(async url => {
        const token = await jwtUtils.generateToken(c, {purpose: 'mail-resource', url}, remaining);
        return [url, `${new URL(c.req.url).origin}/api/email/resource/${token}`];
    }));
    return new Map(entries);
}

/** 只对已授权邮件中的资源签发代理地址；不接受客户端提交任意待代理 URL。 */
export async function createProxiedContent(c, html, options) {
    const document = parseMailDocument(html);
    const targets = new Set();
    rewriteEmailResources(document, {...options, rewriteRemote: url => { targets.add(url); return url; }}, {cssTree, parseSrcset});
    const urls = await proxyUrls(c, targets, options.expiresAt || Math.floor(Date.now() / 1000) + RESOURCE_TTL_SECONDS);
    rewriteEmailResources(document, {...options, rewriteRemote: url => urls.get(url)}, {cssTree, parseSrcset});
    return document.toString();
}

async function readResource(response, limit) {
    if (Number(response.headers.get('Content-Length')) > limit) {
        await response.body?.cancel();
        throw Object.assign(new Error('Resource is too large'), {status: 413});
    }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
            await reader.cancel();
            throw Object.assign(new Error('Resource is too large'), {status: 413});
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}

export async function proxyResource(c, token, {fetcher = fetch} = {}) {
    const payload = await jwtUtils.verifyToken(c, token);
    const now = Math.floor(Date.now() / 1000);
    if (!payload || payload.purpose !== 'mail-resource' || !Number.isInteger(payload.exp) || !Number.isInteger(payload.iat) || now >= payload.exp || payload.exp > payload.iat + RESOURCE_TTL_SECONDS) {
        return new Response('Resource access denied', {status: 403, headers: RESPONSE_HEADERS});
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RESOURCE_TIMEOUT_MS);
    try {
        const ownOrigin = new URL(c.req.url).origin;
        let url = checkedTarget(payload.url, ownOrigin);
        for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            await checkDns(url, {fetcher, signal: controller.signal});
            const response = await fetcher(url.href, {headers: anonymousHeaders('image/*, text/css, font/*, audio/*, video/*'), redirect: 'manual', signal: controller.signal});
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                await response.body?.cancel();
                const location = response.headers.get('Location');
                if (!location) throw new Error('Missing resource redirect location');
                url = checkedTarget(new URL(location, url).href, ownOrigin);
                continue;
            }
            const mime = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
            if (!response.ok || !/^(?:image\/[\w.+-]+|font\/[\w.+-]+|audio\/[\w.+-]+|video\/[\w.+-]+|application\/(?:font-woff|vnd\.ms-fontobject)|text\/css)$/.test(mime)) {
                await response.body?.cancel();
                throw new Error('Unsupported or failed remote resource');
            }
            let body = await readResource(response, mime === 'text/css' ? MAX_CSS_BYTES : MAX_RESOURCE_BYTES);
            if (mime === 'text/css') {
                const css = new TextDecoder().decode(body);
                const targets = new Set();
                const options = {baseUrl: url.href, proxyAll: true};
                rewriteCss(css, {cssTree, policy: resourcePolicy({...options, rewriteRemote: target => { targets.add(target); return target; }})});
                const urls = await proxyUrls(c, targets, payload.exp);
                body = rewriteCss(css, {cssTree, policy: resourcePolicy({...options, rewriteRemote: target => urls.get(target)})});
            }
            return new Response(body, {headers: {...RESPONSE_HEADERS, 'Content-Type': mime === 'text/css' ? 'text/css; charset=utf-8' : mime}});
        }
        throw new Error('Too many resource redirects');
    } catch (error) {
        return new Response(controller.signal.aborted ? 'Resource request timed out' : error.message, {status: controller.signal.aborted ? 504 : error.status || 502, headers: RESPONSE_HEADERS});
    } finally {
        clearTimeout(timeout);
    }
}
