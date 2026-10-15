import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import {createApp, h, nextTick, ref} from 'vue'
import {createPinia} from 'pinia'
import {createI18n} from 'vue-i18n'
import ShadowHtml from '@/components/shadow-html/index.vue'
import {emailRemoteContent} from '@/request/email.js'

vi.mock('@/request/email.js', () => ({emailRemoteContent: vi.fn()}))

const messages = { zh: { remoteContentBlocked: '已屏蔽远程内容', showRemoteContent: '显示', remoteContentError: '远程内容加载失败' } }
let app

async function mount(html) {
    const host = document.createElement('div')
    document.body.append(host)

    const htmlRef = ref(html)
    const emailIdRef = ref(42)
    app = createApp({render: () => h(ShadowHtml, {html: htmlRef.value, emailId: emailIdRef.value})})
    app.use(createPinia())
    app.use(createI18n({ legacy: false, locale: 'zh', messages }))
    app.component('el-button', { setup: (props, { slots }) => () => h('button', slots.default?.()) })
    app.mount(host)
    await nextTick()

    const box = host.firstElementChild
    return { box, shadow: box.querySelector('.content-html').shadowRoot, htmlRef, emailIdRef }
}

describe('ShadowHtml 邮件正文展示', () => {

    beforeEach(() => {
        vi.clearAllMocks()
        emailRemoteContent.mockResolvedValue({content: '<img src="/api/email/resource/signed-resource"><p>正文</p>'})
    })

    afterEach(() => {
        app?.unmount()
        app = null
        document.body.innerHTML = ''
    })

    it('默认不请求代理，点击后仅显示服务器返回的代理资源', async () => {
        const { box, shadow } = await mount('<img src="https://track.example/open.gif"><p>正文</p>')

        expect(shadow.innerHTML).not.toContain('track.example')
        expect(shadow.querySelector('.shadow-content').textContent).toContain('正文')
        expect(box.textContent).toContain('已屏蔽远程内容')
        expect(emailRemoteContent).not.toHaveBeenCalled()

        box.querySelector('button').click()
        await nextTick()
        await nextTick()

        expect(emailRemoteContent).toHaveBeenCalledWith(42)
        expect(shadow.innerHTML).toContain('/api/email/resource/signed-resource')
        expect(shadow.innerHTML).not.toContain('track.example')
        expect(box.textContent).not.toContain('已屏蔽远程内容')
    })

    it('邮件 body 的 style 只作为属性应用，不会污染外壳样式', async () => {
        const { shadow } = await mount('<body style="}</style><img src=x onerror=alert(1)>"><p>ok</p></body>')

        const content = shadow.querySelector('.shadow-content')
        const shellStyle = [...shadow.querySelectorAll('style')].find(style => style.textContent.includes(':host'))
        expect(shellStyle.textContent).not.toContain('</style>')
        expect(content.textContent).toContain('ok')
        expect(shadow.querySelector('img')).toBe(null)
    })

    it('放行远程内容仍清洗脚本和事件，切换邮件后重新屏蔽资源', async () => {
        emailRemoteContent.mockResolvedValue({content: '<img src="/api/email/resource/a" onerror="alert(1)"><script>alert(2)</script><p>第一封</p>'})
        const {box, shadow, htmlRef} = await mount('<img src="https://track.example/a.png" onerror="alert(1)"><script>alert(2)</script><p>第一封</p>')
        box.querySelector('button').click()
        await nextTick()
        await nextTick()

        expect(shadow.querySelector('img').getAttribute('src')).toBe('/api/email/resource/a')
        expect(shadow.querySelector('img').hasAttribute('onerror')).toBe(false)
        expect(shadow.querySelector('script')).toBe(null)

        htmlRef.value = '<img src="https://track.example/b.png" onerror="alert(3)"><p>第二封</p>'
        await nextTick()

        expect(box.textContent).toContain('已屏蔽远程内容')
        expect(shadow.innerHTML).not.toContain('track.example')
        expect(shadow.querySelector('img').hasAttribute('onerror')).toBe(false)
        expect(shadow.querySelector('.shadow-content').textContent).toContain('第二封')
    })

    it('代理失败时提示错误并保持屏蔽', async () => {
        emailRemoteContent.mockRejectedValue(new Error('proxy failed'))
        const {box, shadow} = await mount('<img src="https://track.example/a.png">')
        box.querySelector('button').click()
        await nextTick()
        await nextTick()
        expect(box.textContent).toContain('远程内容加载失败')
        expect(shadow.innerHTML).not.toContain('track.example')
    })

    it('切换邮件后丢弃上一封尚未完成的代理结果，即使正文相同', async () => {
        let finish
        emailRemoteContent.mockImplementation(() => new Promise(resolve => {finish = resolve}))
        const {box, shadow, emailIdRef} = await mount('<img src="https://track.example/a.png">')
        box.querySelector('button').click()
        emailIdRef.value = 43
        await nextTick()
        finish({content: '<img src="/api/email/resource/old-mail">'})
        await nextTick()
        await nextTick()
        expect(shadow.innerHTML).not.toContain('old-mail')
        expect(box.textContent).toContain('已屏蔽远程内容')
    })
})
