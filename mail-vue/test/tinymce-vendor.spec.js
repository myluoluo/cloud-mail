import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'

afterEach(() => {
    window.tinymce?.remove()
    delete window.tinymce
    delete window.tinyMCE
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
})

describe('内置 TinyMCE 解析及序列化', () => {
    it('导入内容不能用内部 data-mce 属性替换已验证的链接', async () => {
        vi.stubGlobal('matchMedia', () => ({matches: false, addListener() {}, removeListener() {}}))
        for (const asset of ['tinymce.min.js', 'themes/silver/theme.min.js', 'models/dom/model.min.js', 'icons/default/icons.min.js']) {
            window.eval(await readFile(resolve('public/tinymce', asset), 'utf8'))
        }
        const host = document.createElement('div')
        document.body.append(host)
        const [editor] = await window.tinymce.init({target: host, inline: true, skin: false, content_css: false,
            license_key: 'gpl', menubar: false, toolbar: false, promotion: false, base_url: '/tinymce'})
        // 仅使用无执行能力的本站路径，验证同一属性覆盖路径。
        editor.setContent('<p><a href="/safe-link" data-mce-href="/override-link">链接</a></p>')
        const content = editor.getContent()
        expect(content).toContain('safe-link')
        expect(content).not.toContain('override-link')
        expect(content).not.toContain('data-mce-href')
    }, 10000)
})
