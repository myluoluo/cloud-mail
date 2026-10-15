// 两个运行时分别提供解析库，避免共享源码依赖某一端的 node_modules 布局。
export const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

export function resourcePolicy(options) {
    const allowedOrigins = new Set([new URL(options.baseUrl).origin, ...(options.allowedOrigins || []).filter(Boolean).map(value => new URL(value, options.baseUrl).origin)])
    let blocked = 0
    return {
        get blockedRemoteCount() { return blocked },
        rewrite(value, stylesheet = false) {
            if (!value) return value
            if (!stylesheet && (value.startsWith('#') || /^(?:data:|blob:|cid:)/i.test(value.trim()))) return value
            try {
                const url = new URL(value, options.baseUrl)
                if (['http:', 'https:'].includes(url.protocol)) {
                    if (allowedOrigins.has(url.origin) && /^\/api\/email\/resource\/[\w.-]+$/.test(url.pathname)) return value
                    if (!stylesheet && !options.proxyAll && allowedOrigins.has(url.origin)) return value
                    const replacement = options.rewriteRemote?.(url.href)
                    if (replacement) return replacement
                }
            } catch { /* 非法资源地址与外链一并移除。 */ }
            blocked += 1
            return null
        },
    }
}

export function rewriteCss(css, {policy, cssTree, context = 'stylesheet'}) {
    if (!css) return ''
    let ast
    try {
        // 先按 CSS token 归一化转义的函数名和 at-rule 名，不能让 u\72l 绕过 URL 节点识别。
        const tokens = []
        cssTree.tokenize(css, (type, start, end) => {
            const token = css.slice(start, end)
            if (type === cssTree.tokenTypes.Function) tokens.push(cssTree.ident.encode(cssTree.ident.decode(token.slice(0, -1))) + '(')
            else if (type === cssTree.tokenTypes.AtKeyword) tokens.push('@' + cssTree.ident.encode(cssTree.ident.decode(token.slice(1))))
            else tokens.push(token)
        })
        ast = cssTree.parse(tokens.join(''), {context, parseCustomProperty: true})
    } catch {
        // 无法解析的 CSS 不能原样进入页面，其中可能隐藏浏览器能识别的资源引用。
        return ''
    }
    cssTree.walk(ast, function(node, item, list) {
        if (node.type === 'Raw') {
            node.value = ''
        } else if (node.type === 'PseudoClassSelector' && /^host(?:-context)?$/i.test(cssTree.ident.decode(node.name))) {
            node.name = 'not'
            node.children = cssTree.parse('*', {context: 'selectorList'}).children
        } else if (node.type === 'Declaration' && cssTree.ident.decode(node.property).toLowerCase() === 'position' && cssTree.ident.decode(cssTree.generate(node.value)).toLowerCase() === 'fixed') {
            list.remove(item)
        } else if (node.type === 'Url') {
            const imported = this.atrule && cssTree.ident.decode(this.atrule.name).toLowerCase() === 'import' && !this.declaration
            node.value = policy.rewrite(node.value, imported) || PLACEHOLDER_IMAGE
        } else if (node.type === 'String') {
            const functionName = this.function && cssTree.ident.decode(this.function.name).toLowerCase()
            const importUrl = this.atrule && cssTree.ident.decode(this.atrule.name).toLowerCase() === 'import' && !this.declaration
            if (importUrl || ['image-set', '-webkit-image-set', 'src'].includes(functionName)) {
                node.value = policy.rewrite(node.value, importUrl) || PLACEHOLDER_IMAGE
            }
        }
    })
    // CSS 反转义后可能产生 </style>，不能让它在 HTML 再解析时闭合样式元素。
    return cssTree.generate(ast).replace(/</g, '\\3C ')
}

export function rewriteEmailResources(root, options, {cssTree, parseSrcset}) {
    const policy = resourcePolicy(options)
    for (const element of root.querySelectorAll('*')) {
        for (const attr of ['src', 'poster', 'background']) {
            if (!element.hasAttribute(attr)) continue
            const replacement = policy.rewrite(element.getAttribute(attr))
            if (replacement !== null) element.setAttribute(attr, replacement)
            else if (attr === 'src' && element.localName === 'img') element.setAttribute(attr, PLACEHOLDER_IMAGE)
            else element.removeAttribute(attr)
        }
        if (element.hasAttribute('srcset')) {
            const candidates = parseSrcset(element.getAttribute('srcset')).map(candidate => ({...candidate, url: policy.rewrite(candidate.url)}))
            // 屏蔽时整组移除，避免浏览器从残留候选中选择未经用户确认的地址。
            if (candidates.some(candidate => candidate.url === null)) element.removeAttribute('srcset')
            else element.setAttribute('srcset', candidates.map(({url, w, h, d}) => `${url}${w ? ` ${w}w` : ''}${h ? ` ${h}h` : ''}${d ? ` ${d}x` : ''}`).join(', '))
        }
        if (element.hasAttribute('style')) element.setAttribute('style', rewriteCss(element.getAttribute('style'), {policy, cssTree, context: 'declarationList'}))
        if (element.localName === 'style') element.textContent = rewriteCss(element.textContent, {policy, cssTree})
        // 邮件不能自行降低资源请求的 Referrer 策略。
        if (element.hasAttribute('referrerpolicy')) element.setAttribute('referrerpolicy', 'no-referrer')
    }
    return policy.blockedRemoteCount
}
