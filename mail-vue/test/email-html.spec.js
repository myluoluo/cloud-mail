import {beforeEach, describe, expect, it, vi} from 'vitest'
import {buildEmailContent} from '@/utils/email-html.js'

const OSS = 'https://oss.example.com'

function render(html, options = {}) {
    return buildEmailContent(html, {allowedOrigins: [OSS], ...options})
}

describe('buildEmailContent 清洗不可信邮件正文', () => {

    it('剥离脚本、事件处理器与危险协议', () => {
        const {html} = render(`<p onclick="alert(1)">a</p><script>alert(2)</script>
<img src="https://track.example/p.gif" onerror="alert(3)">
<svg onload="alert(4)"></svg><iframe src="https://track.example/f"></iframe>
<a href="javascript:alert(5)">x</a>`)

        expect(html).toContain('<p>a</p>')
        expect(html).toContain('<a>x</a>')
        expect(html).not.toMatch(/onerror|onclick|onload|<script|iframe|javascript:/i)
    })

    it('移除表单类元素，避免正文伪装成凭证输入', () => {
        const {html} = render('<form action="https://evil.example/login"><input name="password"><button>登录</button></form>')

        expect(html).not.toMatch(/<form|<input|<button/i)
    })

    it('邮件 body 的 style 注入不会变成正文标记', () => {
        const {html} = render('<body style="}</style><img src=x onerror=alert(1)>"><p>ok</p></body>')

        expect(html).toContain('<p>ok</p>')
        expect(html).not.toContain('<img src=x')
        expect(html).not.toContain('onerror')
    })

    it('保留邮件 head 中的样式表，并单独返回 body 样式', () => {
        const {html, bodyStyle} = render('<html><head><style>.b{color:#333}</style></head><body style="background:#fff"><p>x</p></body></html>')

        expect(html.match(/<style>([\s\S]*)<\/style>/)?.[1]).toMatch(/\.b\s*\{[^}]*color/)
        expect(html).not.toMatch(/<head|<body|<!DOCTYPE/i)
        expect(bodyStyle).toMatch(/background/)
    })

    it('默认拦截远程图片，只留占位图与原始尺寸', () => {
        const {html, blockedRemoteCount} = render('<img src="https://track.example/open.gif" width="1" height="1">')

        expect(blockedRemoteCount).toBe(1)
        expect(html).not.toContain('track.example')
        expect(html).toContain('width="1"')
        expect(html).toContain('src="data:image/gif;base64,')
    })

    it('用户放行后远程图片恢复', () => {
        const {html, blockedRemoteCount} = render('<img src="https://track.example/open.gif">', {allowRemote: true})

        expect(blockedRemoteCount).toBe(0)
        expect(html).toContain('https://track.example/open.gif')
    })

    it('拦截 CSS 与属性里的远程引用，并清理 :host 与固定定位', () => {
        const {html, blockedRemoteCount} = render(`<style>.a{background:url(https://track.example/b.png)}
@import url(https://track.example/a.css);:host{position:fixed;inset:0}.b{position:fixed;top:0}</style>
<div style="background:url('https://track.example/c.png');position:fixed">x</div>`)

        expect(blockedRemoteCount).toBeGreaterThan(0)
        expect(html).not.toContain('track.example')
        expect(html).not.toContain(':host')
        expect(html).not.toMatch(/position\s*:\s*fixed/i)
    })

    it('拦截带媒体查询的 @import 与 image-set 字符串写法', () => {
        const {html, blockedRemoteCount} = render(`<style>@import "https://track.example/a.css" screen and (min-width:100px);
@import url(https://track.example/b.css) print;.a{background-image:image-set("https://track.example/c.png" 1x)}</style>`)

        expect(blockedRemoteCount).toBeGreaterThan(0)
        expect(html).not.toContain('track.example')
    })

    it('没有构造样式表能力时同样拦截远程引用', async () => {
        vi.resetModules()
        vi.stubGlobal('CSSStyleSheet', class {})
        const {buildEmailContent} = await import('@/utils/email-html.js')

        const {html, blockedRemoteCount} = buildEmailContent(`<style>@import "https://track.example/a.css" screen and (min-width:100px);
@import url(https://track.example/b.css) print;@import url(https://track.example/e.css) no-semicolon
.a{background:url(https://track.example/c.png);background-image:image-set("https://track.example/d.png" 1x);position:fixed}</style>`, {allowedOrigins: []})

        vi.unstubAllGlobals()
        vi.resetModules()
        expect(blockedRemoteCount).toBe(5)
        expect(html).not.toContain('track.example')
        expect(html).not.toMatch(/position\s*:\s*fixed/i)
    })

    it('拦截注释拆分的固定定位', () => {
        const {html} = render('<style>.a{position/**/:fixed;top:0}</style>')

        expect(html).not.toMatch(/position\s*:\s*fixed/i)
    })

    it('拦截视频海报、source 与表格背景等位置的远程资源', () => {
        const {html, blockedRemoteCount} = render(`<video poster="https://track.example/p.jpg"><source src="https://track.example/v.mp4" srcset="https://track.example/v2.mp4 2x"></video>
<table background="https://track.example/bg.png"><tr><td>x</td></tr></table><img src="/attachments/keep.png">`)

        expect(blockedRemoteCount).toBe(4)
        expect(html).not.toContain('track.example')
        expect(html).toContain('/attachments/keep.png')
    })

    it('远程 CSS 在用户放行后恢复', () => {
        const {html, blockedRemoteCount} = render('<style>.a{background:url(https://track.example/b.png)}</style>', {allowRemote: true})

        expect(blockedRemoteCount).toBe(0)
        expect(html).toContain('https://track.example/b.png')
    })

    it('剥离表单提交类属性', () => {
        const {html} = render('<input type="image" formaction="https://evil.example/login"><button formaction="https://evil.example/login">go</button>')

        expect(html).not.toMatch(/formaction|<input|<button/i)
    })

    it('拦截 srcset 中的远程候选', () => {
        const {html, blockedRemoteCount} = render('<img src="/attachments/b.png" srcset="/attachments/b.png 1x, https://track.example/b2.png 2x">')

        expect(blockedRemoteCount).toBe(1)
        expect(html).not.toContain('srcset')
        expect(html).toContain('/attachments/b.png')
    })

    it('站内图片、相对路径与内联图片照常保留', () => {
        const {html, blockedRemoteCount} = render(`<img src="${OSS}/att/a.png">
<img src="/attachments/b.png"><img src="data:image/png;base64,iVBORw0KGgo=">`)

        expect(blockedRemoteCount).toBe(0)
        expect(html).toContain(`${OSS}/att/a.png`)
        expect(html).toContain('/attachments/b.png')
        expect(html).toContain('data:image/png;base64,')
    })

    it('站内域名配置带路径时仍视为站内资源', () => {
        const {html, blockedRemoteCount} = render(`<img src="${OSS}/mail/att/a.png">`, {allowedOrigins: [`${OSS}/mail/`]})

        expect(blockedRemoteCount).toBe(0)
        expect(html).toContain(`${OSS}/mail/att/a.png`)
    })

    it('正文链接改为外部打开并带上 rel', () => {
        const {html} = render('<a href="https://evil.example/click">x</a>')

        expect(html).toContain('href="https://evil.example/click"')
        expect(html).toContain('target="_blank"')
        expect(html).toContain('rel="noopener noreferrer nofollow"')
    })
})
