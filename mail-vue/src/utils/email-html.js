import DOMPurify from 'dompurify'

/**
 * 邮件正文由发件人完全控制，进入页面 DOM 前必须经过这里。
 * 这里只做两件事：把不可信 HTML 收敛到安全子集；把远程资源挡在用户主动放行之前。
 */

// 邮件排版常用、但 DOMPurify 默认不带的标签
const EMAIL_TAGS = ['style', 'center', 'font']

// 对邮件展示没有实际价值，却是钓鱼与欺骗常用载体的能力
const FORBIDDEN_TAGS = [
    'form', 'input', 'button', 'select', 'option', 'textarea', 'label', 'fieldset', 'legend',
    'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
    'link', 'meta', 'base', 'noscript', 'template',
]

const FORBIDDEN_ATTRS = ['srcdoc', 'formaction', 'action', 'ping']

const PURIFY_CONFIG = {
    // 只保留 HTML 命名空间，丢掉 SVG/MathML 这类 mXSS 温床
    USE_PROFILES: { html: true },
    ALLOW_DATA_ATTR: false,
    ADD_TAGS: EMAIL_TAGS,
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTRS,
    // 邮件样式多写在 <head>，按 body 片段解析才能保留它们
    FORCE_BODY: true,
}

// 会发起网络请求的资源属性，srcset 单独判断
const RESOURCE_ATTRS = ['src', 'poster', 'background']

const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const CSS_URL_RE = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?(['"]?)([^;'")\s]+)\1\s*\)?(?:\s+[^;{]*)?;?/gi
// 构造样式表不可用时，image-set 的字符串写法不会落到 url() 分支
const CSS_IMAGE_SET_RE = /(?:-webkit-)?image-set\(\s*['"]([^'"]*)['"]/gi
const CSS_SRCSET_URL_RE = /(?:https?:)?\/\/[^\s,]+/gi
// :host 能反过来给宿主元素定位/铺满，属于邮件不该具备的越界能力
const HOST_RULE_RE = /:host(?:-context)?\s*(?:\([^)]*\))?/gi
const FIXED_POSITION_RE = /(^|[;{](?:\s|\/\*[\s\S]*?\*\/)*)position(?:\s|\/\*[\s\S]*?\*\/)*:(?:\s|\/\*[\s\S]*?\*\/)*fixed\b[^;}]*;?/gi

const CONSTRUCTABLE_STYLESHEET = typeof CSSStyleSheet === 'function' && typeof CSSStyleSheet.prototype.replaceSync === 'function'

/**
 * 交给浏览器自己的 CSS 解析器重写一遍：把 \66 ixed、u\72 l()、注释、字符串形式的 image-set
 * 这类写法还原成常规形式，后续按文本匹配的策略才拦得住。取不到构造样式表能力时退回原文。
 */
function normalizeStyleSheet(css) {
    if (!CONSTRUCTABLE_STYLESHEET) return css
    try {
        const sheet = new CSSStyleSheet()
        sheet.replaceSync(css)
        return [...sheet.cssRules].map(rule => rule.cssText).join('\n')
    } catch {
        return css
    }
}

// style 属性是声明列表而非样式表，按声明解析才能拿到归一化结果
function normalizeDeclarationList(css) {
    const element = document.createElement('div')
    element.setAttribute('style', css)
    return element.style.cssText
}

// CSS 转义被解码后可能剩出字面 "</style>"，写回 raw-text 元素前必须断开，
// 否则序列化再解析时样式會被提前闭合（CSS 里 \/ 与 / 等价，语义不变）
function escapeRawText(css) {
    return css.replace(/<\/style/gi, '<\\/style')
}

function resolveOrigin(url) {
    try {
        const absolute = url.startsWith('//') ? `${window.location.protocol}${url}` : url
        return new URL(absolute, window.location.href).origin
    } catch {
        return null
    }
}

function isRemoteUrl(value, allowedOrigins) {
    const url = String(value ?? '').trim()
    if (!url) return false
    // data:/blob:/cid: 是邮件自身携带的内容，mailto:/tel:/# 需要用户点击，都不发远程请求
    if (/^(?:data:|blob:|cid:|mailto:|tel:|#)/i.test(url)) return false
    // 相对路径与站内绝对路径都是同源资源
    if (!/^(?:https?:)?\/\//i.test(url)) return false
    const origin = resolveOrigin(url)
    return !origin || !allowedOrigins.has(origin)
}

/**
 * 剥离远程引用的 CSS，同时去掉邮件不该有的 :host 规则与固定定位。
 * @returns {{ css: string, blocked: number }}
 */
function normalizeCss(css, { allowRemote, allowedOrigins }, normalizeText) {
    if (!css) return { css, blocked: 0 }
    let blocked = 0
    const blockedRemoteUrl = url => {
        if (allowRemote || !isRemoteUrl(url, allowedOrigins)) return false
        blocked += 1
        return true
    }
    const normalized = normalizeText(css)
        .replace(CSS_IMPORT_RE, (match, quote, url) => (blockedRemoteUrl(url) ? '' : match))
        .replace(CSS_URL_RE, (match, quote, url) => (blockedRemoteUrl(url) ? 'none' : match))
        .replace(CSS_IMAGE_SET_RE, (match, url) => (blockedRemoteUrl(url) ? 'none' : match))
        .replace(HOST_RULE_RE, ':not(*)')
        .replace(FIXED_POSITION_RE, '$1')
    return { css: normalized, blocked }
}

function normalizeAttributes(element, policy) {
    let blocked = 0
    for (const attr of RESOURCE_ATTRS) {
        const value = element.getAttribute(attr)
        if (!value || !isRemoteUrl(value, policy.allowedOrigins) || policy.allowRemote) continue
        blocked += 1
        if (attr === 'src' && element.tagName === 'IMG') element.setAttribute(attr, PLACEHOLDER_IMAGE)
        else element.removeAttribute(attr)
    }

    const srcset = element.getAttribute('srcset')
    if (srcset && !policy.allowRemote && srcset.match(CSS_SRCSET_URL_RE)?.some(url => isRemoteUrl(url, policy.allowedOrigins))) {
        element.removeAttribute('srcset')
        blocked += 1
    }

    const style = element.getAttribute('style')
    if (style) {
        const result = normalizeCss(style, policy, normalizeDeclarationList)
        if (result.css !== style) element.setAttribute('style', result.css)
        blocked += result.blocked
    }
    return blocked
}

/**
 * 清洗邮件 HTML 并按策略处理远程资源。
 * @param {string} rawHtml 邮件正文（{{domain}} 需由调用方替换后再传入）
 * @param {{ allowRemote?: boolean, allowedOrigins?: string[] }} options
 *        allowRemote 为 true 表示用户已主动放行远程内容；allowedOrigins 是站内资源域名
 * @returns {{ html: string, bodyStyle: string, blockedRemoteCount: number }}
 */
export function buildEmailContent(rawHtml, options = {}) {
    const policy = {
        allowRemote: options.allowRemote === true,
        // 配置可能带路径或结尾斜杠，统一收敛到 origin 再比较
        allowedOrigins: new Set([window.location.origin, ...(options.allowedOrigins || []).filter(Boolean).map(resolveOrigin)]),
    }

    // 取邮件自身 <body> 上的 style；DOMParser 生成的文档没有浏览上下文，不会触发请求
    const parsed = new DOMParser().parseFromString(rawHtml || '', 'text/html')
    const rawBodyStyle = parsed.body?.getAttribute('style') || ''

    // DOMPurify 以字符串入参时会先解析成惰性文档；这里再把结果放进 <template>，
    // 使远程资源的替换发生在任何真实请求之前。
    const template = document.createElement('template')
    template.innerHTML = DOMPurify.sanitize(rawHtml || '', PURIFY_CONFIG)
    const holder = template.content

    let blockedRemoteCount = 0
    for (const element of holder.querySelectorAll('*')) {
        blockedRemoteCount += normalizeAttributes(element, policy)
    }
    for (const styleElement of holder.querySelectorAll('style')) {
        const result = normalizeCss(styleElement.textContent, policy, normalizeStyleSheet)
        const css = escapeRawText(result.css)
        if (css !== styleElement.textContent) styleElement.textContent = css
        blockedRemoteCount += result.blocked
    }

    for (const link of holder.querySelectorAll('a[href], area[href]')) {
        link.setAttribute('target', '_blank')
        link.setAttribute('rel', 'noopener noreferrer nofollow')
    }

    const bodyStyle = normalizeCss(rawBodyStyle, policy, normalizeDeclarationList)
    blockedRemoteCount += bodyStyle.blocked

    return { html: template.innerHTML, bodyStyle: bodyStyle.css, blockedRemoteCount }
}
