import DOMPurify from 'dompurify'
import * as cssTree from 'css-tree'
import parseSrcset from 'parse-srcset'
import {resourcePolicy, rewriteCss, rewriteEmailResources} from '../../../shared/email-resources.js'

const PURIFY_CONFIG = {
    USE_PROFILES: {html: true},
    ALLOW_DATA_ATTR: false,
    ADD_TAGS: ['style', 'center', 'font', 'template'],
    FORBID_TAGS: [
        'form', 'input', 'button', 'select', 'option', 'textarea', 'label', 'fieldset', 'legend',
        'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
        'link', 'meta', 'base', 'noscript',
    ],
    FORBID_ATTR: ['srcdoc', 'formaction', 'action', 'ping'],
    IN_PLACE: true,
}

/** 清洗正文并在插入真实 DOM 前屏蔽所有外部资源；放行后的正文由服务器改写为代理 URL。 */
export function buildEmailContent(rawHtml, options = {}) {
    const policyOptions = {baseUrl: window.location.href, allowedOrigins: options.allowedOrigins}
    // template 的片段解析会忽略 body 标签；仅提取完整起始标签，再在惰性模板内读取其 style。
    const bodyTag = (rawHtml || '').match(/<body\b(?:[^>"']|"[^"]*"|'[^']*')*>/i)?.[0]
    const bodyTemplate = document.createElement('template')
    if (bodyTag) bodyTemplate.innerHTML = bodyTag.replace(/^<body\b/i, '<div') + '</div>'
    const rawBodyStyle = bodyTemplate.content.firstElementChild?.getAttribute('style') || ''
    const template = document.createElement('template')
    template.innerHTML = rawHtml || ''
    for (const nested of template.content.querySelectorAll('template')) nested.remove()
    // 原始 HTML 始终留在惰性 template 中；原地清洗避免 DOMParser/importNode 的预加载窗口。
    DOMPurify.sanitize(template, PURIFY_CONFIG)
    let blockedRemoteCount = rewriteEmailResources(template.content, policyOptions, {cssTree, parseSrcset})
    const bodyPolicy = resourcePolicy(policyOptions)
    const bodyStyle = rewriteCss(rawBodyStyle, {policy: bodyPolicy, cssTree, context: 'declarationList'})
    blockedRemoteCount += bodyPolicy.blockedRemoteCount
    for (const link of template.content.querySelectorAll('a[href], area[href]')) {
        link.setAttribute('target', '_blank')
        link.setAttribute('rel', 'noopener noreferrer nofollow')
    }
    return {html: template.innerHTML, bodyStyle, blockedRemoteCount}
}
