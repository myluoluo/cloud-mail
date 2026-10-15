import {afterEach, describe, expect, it, vi} from 'vitest'
import {createApp, h, nextTick, ref} from 'vue'
import {createPinia} from 'pinia'
import {createI18n} from 'vue-i18n'
import TinyEditor from '@/components/tiny-editor/index.vue'
import {useSettingStore} from '@/store/setting.js'

let app

async function mount(content) {
    let html = ''
    const events = new Map()
    // 仅隔离 TinyMCE 运行时，检查真实组件交给 setContent 的 HTML。
    const editor = {
        on: (name, callback) => events.set(name, callback),
        setContent: vi.fn(value => {html = value}),
        getContent: () => html,
        destroy: vi.fn(),
        focus: vi.fn(),
    }
    vi.stubGlobal('tinymce', {init: config => {
        config.setup(editor)
        events.get('init')()
    }})
    const value = ref(content)
    const pinia = createPinia()
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({render: () => h(TinyEditor, {defValue: value.value})})
    app.use(pinia)
    app.use(createI18n({legacy: false, locale: 'zh', messages: {zh: {}}}))
    useSettingStore(pinia).settings.r2Domain = 'https://oss.example.com'
    app.mount(host)
    await nextTick()
    return {editor, value}
}

afterEach(() => {
    app?.unmount()
    app = null
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
})

describe('编辑器导入邮件原文的远程资源策略', () => {
    it('初始化回复引用前拦截跟踪图片和 CSS，保留引用文字及本站附件', async () => {
        const {editor} = await mount(`<blockquote class="mceNonEditable"><p>引用正文</p>
<img src="https://track.example/open.gif" width="1" height="1">
<div style="background:url(https://track.example/bg.png)">内容</div>
<img src="https://oss.example.com/attachments/a.png"></blockquote>`)

        const imported = editor.setContent.mock.calls.at(-1)[0]
        expect(imported).not.toContain('track.example')
        expect(imported).toContain('引用正文')
        expect(imported).toContain('mceNonEditable')
        expect(imported).toContain('https://oss.example.com/attachments/a.png')
    })

    it('更新回复全部、转发或草稿内容时同样在 setContent 前拦截资源', async () => {
        const {editor, value} = await mount('<p>旧内容</p>')
        value.value = `<p>转发正文</p><style>@import "https://track.example/a.css";</style>
<img src="/attachments/a.png" srcset="/attachments/a.png 1x, https://track.example/a.png 2x">
<img src="blob:https://mail.example.com/local-upload">`
        await nextTick()

        const imported = editor.setContent.mock.calls.at(-1)[0]
        expect(imported).not.toContain('track.example')
        expect(imported).not.toContain('srcset')
        expect(imported).toContain('转发正文')
        expect(imported).toContain('/attachments/a.png')
        expect(imported).toContain('blob:https://mail.example.com/local-upload')
    })
})
