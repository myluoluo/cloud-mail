import { describe, expect, it, beforeEach } from 'vitest'
import {createApp, h, nextTick} from 'vue'
import {createPinia} from 'pinia'
import {createI18n} from 'vue-i18n'
import ShadowHtml from '@/components/shadow-html/index.vue'

const messages = { zh: { remoteContentBlocked: '已屏蔽远程内容', showRemoteContent: '显示' } }

async function mount(html) {
    const host = document.createElement('div')
    document.body.append(host)

    const app = createApp(ShadowHtml, { html })
    app.use(createPinia())
    app.use(createI18n({ legacy: false, locale: 'zh', messages }))
    app.component('el-button', { setup: (props, { slots }) => () => h('button', slots.default?.()) })
    app.mount(host)
    await nextTick()

    const box = host.firstElementChild
    return { box, shadow: box.querySelector('.content-html').shadowRoot }
}

describe('ShadowHtml 邮件正文展示', () => {

    beforeEach(() => {
        document.body.innerHTML = ''
    })

    it('默认屏蔽远程内容，并可由用户手动放行', async () => {
        const { box, shadow } = await mount('<img src="https://track.example/open.gif"><p>正文</p>')

        expect(shadow.innerHTML).not.toContain('track.example')
        expect(shadow.querySelector('.shadow-content').textContent).toContain('正文')
        expect(box.textContent).toContain('已屏蔽远程内容')

        box.querySelector('button').click()
        await nextTick()

        expect(shadow.innerHTML).toContain('https://track.example/open.gif')
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
})
