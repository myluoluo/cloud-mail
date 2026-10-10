import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createApp, h} from 'vue'
import {createPinia, setActivePinia} from 'pinia'
import {createI18n} from 'vue-i18n'
import {useSettingStore} from '@/store/setting.js'
import zh from '@/i18n/zh.js'

const {oauthPocketIdLogin, oauthPocketIdAuthorize, loginUserInfo, login} = vi.hoisted(() => ({oauthPocketIdLogin: vi.fn(), oauthPocketIdAuthorize: vi.fn(), loginUserInfo: vi.fn(), login: vi.fn()}))
vi.mock('@/request/ouath.js', () => ({oauthPocketIdLogin, oauthPocketIdAuthorize, oauthBindUser: vi.fn(), oauthGithubLogin: vi.fn(), oauthGoogleLogin: vi.fn(), oauthLinuxDoLogin: vi.fn()}))
vi.mock('@/request/my.js', () => ({loginUserInfo}))
vi.mock('@/request/login.js', () => ({login, register: vi.fn()}))
vi.mock('@/request/setting.js', () => ({websiteConfig: vi.fn().mockResolvedValue({domainList: []})}))
vi.mock('@/layout/index.vue', () => ({default: {template: '<div></div>'}}))
vi.mock('@iconify/vue', () => ({Icon: {template: '<span></span>'}}))
const {default: router} = await import('@/router/index.js')
const {default: Login} = await import('@/views/login/index.vue')
let app
let pinia

function mountLogin() {
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({render: () => h(Login)})
    app.use(pinia).use(router).use(createI18n({legacy: false, locale: 'zh', missingWarn: false, fallbackWarn: false, messages: {zh}}))
    app.directive('loading', {})
    app.component('el-button', {setup: (_, {slots}) => () => h('button', slots.default?.())})
    app.component('el-input', {
        props: ['modelValue', 'placeholder'], emits: ['update:modelValue'],
        setup: (props, {emit}) => () => h('input', {
            value: props.modelValue, placeholder: props.placeholder,
            onInput: event => emit('update:modelValue', event.target.value),
        }),
    })
    for (const name of ['el-dialog', 'el-select', 'el-option', 'el-avatar']) {
        app.component(name, {setup: (_, {slots}) => () => h('div', slots.default?.())})
    }
    app.mount(host)
    return host
}

describe('登录入口与通知链接跳转', () => {
    beforeEach(async () => {
        vi.clearAllMocks()
        vi.stubGlobal('ElMessage', vi.fn())
        vi.stubEnv('DEV', true)
        vi.stubEnv('VITE_POCKET_ID_PREVIEW', '')
        localStorage.clear()
        sessionStorage.clear()
        pinia = createPinia()
        setActivePinia(pinia)
        useSettingStore().settings = {loginDomain: 1, loginOpacity: 1, pocketIdSwitch: 0}
        await router.replace('/login')
        window.history.replaceState({}, '', '/login')
    })

    afterEach(() => {
        app?.unmount()
        app = null
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        document.head.querySelectorAll('script[src="https://challenges.cloudflare.com/turnstile/v0/api.js"]').forEach(script => script.remove())
        document.body.innerHTML = ''
    })

    it('未登录打开通知链接时保留目标邮件 ID', async () => {
        await router.push('/mail?id=42')
        expect(router.currentRoute.value.name).toBe('login')
        expect(sessionStorage.getItem('mailRedirectId')).toBe('42')
    })

    it('Pocket ID 登录回调后打开原邮件，消费保存的目标 ID', async () => {
        sessionStorage.setItem('mailRedirectId', '42')
        sessionStorage.setItem('oauthProvider', 'pocketId')
        await router.replace('/login?code=test-code&state=test-state')
        oauthPocketIdLogin.mockResolvedValue({token: 'test-token', userInfo: {}})
        loginUserInfo.mockResolvedValue({userId: 7, account: {accountId: 3}, permKeys: []})
        mountLogin()
        await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('content'), {timeout: 5000})
        expect(router.currentRoute.value.query.id).toBe('42')
        expect(sessionStorage.getItem('mailRedirectId')).toBe(null)
        expect(oauthPocketIdLogin).toHaveBeenCalledWith('test-code', 'test-state', `${window.location.origin}/login`)
    })

    it('开发预览显示 Pocket ID，可展开密码登录，点击仍调用真实授权入口', async () => {
        useSettingStore().settings.pocketIdSwitch = 1
        vi.stubEnv('VITE_POCKET_ID_PREVIEW', 'true')
        oauthPocketIdAuthorize.mockRejectedValue(new Error('Pocket ID OAuth 未配置'))
        const host = mountLogin()
        const button = [...host.querySelectorAll('button')].find(node => node.textContent.includes(zh.pocketIdLogin))
        expect(button).toBeDefined()
        expect(host.querySelector('#password-login-form').style.display).toBe('none')

        host.querySelector('.password-login-toggle').click()
        await vi.waitFor(() => expect(host.querySelector('#password-login-form').style.display).not.toBe('none'))
        button.click()
        await vi.waitFor(() => expect(oauthPocketIdAuthorize).toHaveBeenCalledWith(`${window.location.origin}/login`))
        await vi.waitFor(() => expect(sessionStorage.getItem('oauthProvider')).toBe(null))
    })

    it('生产模式忽略预览开关，未配置 Pocket ID 时保留密码登录', () => {
        useSettingStore().settings.pocketIdSwitch = 1
        vi.stubEnv('DEV', false)
        vi.stubEnv('VITE_POCKET_ID_PREVIEW', 'true')
        const host = mountLogin()
        expect([...host.querySelectorAll('button')].some(node => node.textContent.includes(zh.pocketIdLogin))).toBe(false)
        expect(host.querySelector('.password-login-toggle')).toBe(null)
        expect(host.querySelector('#password-login-form').style.display).not.toBe('none')
    })

    it('密码登录等待验证码，验证后提交 token 并在登录失败后重置', async () => {
        useSettingStore().settings = {loginDomain: 1, loginOpacity: 1, pocketIdSwitch: 1, loginVerify: true, siteKey: 'test-site-key'}
        let callbacks
        const turnstile = {render: vi.fn((element, options) => {callbacks = options; return 'login-widget'}), reset: vi.fn(), remove: vi.fn(), ready: fn => fn()}
        vi.stubGlobal('turnstile', turnstile)
        const error = new Error('密码错误')
        login.mockRejectedValue(error)
        const host = mountLogin()
        app.config.errorHandler = vi.fn()
        await vi.waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce())
        expect(callbacks).toMatchObject({sitekey: 'test-site-key', action: 'login'})
        for (const [placeholder, value] of [[zh.emailAccount, 'user@example.com'], [zh.password, 'correct-password']]) {
            const input = host.querySelector(`#password-login-form input[placeholder="${placeholder}"]`)
            input.value = value
            input.dispatchEvent(new Event('input', {bubbles: true}))
        }
        const submit = [...host.querySelectorAll('#password-login-form button')].find(node => node.textContent.includes(zh.loginBtn))
        callbacks.callback('expired-token')
        callbacks['expired-callback']()
        submit.click()
        expect(login).not.toHaveBeenCalled()
        callbacks.callback('verified-token')
        submit.click()
        await vi.waitFor(() => expect(login).toHaveBeenCalledWith('user@example.com', 'correct-password', 'verified-token'))
        await vi.waitFor(() => expect(turnstile.reset).toHaveBeenCalledWith('login-widget'))
        expect(app.config.errorHandler).toHaveBeenCalledWith(error, expect.anything(), 'native event handler')
        submit.click()
        expect(login).toHaveBeenCalledOnce()
    })

    it('Pocket ID 主入口不加载密码验证码，展开密码表单后才渲染', async () => {
        useSettingStore().settings = {loginDomain: 1, loginOpacity: 1, pocketIdSwitch: 0, loginVerify: true, siteKey: 'test-site-key'}
        const turnstile = {render: vi.fn(() => 'login-widget'), reset: vi.fn(), remove: vi.fn(), ready: fn => fn()}
        vi.stubGlobal('turnstile', turnstile)
        const host = mountLogin()
        expect(turnstile.render).not.toHaveBeenCalled()
        host.querySelector('.password-login-toggle').click()
        await vi.waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce())
        host.querySelector('.password-login-toggle').click()
        await vi.waitFor(() => expect(turnstile.remove).toHaveBeenCalledWith('login-widget'))
    })

    it('验证码脚本在挂载前失败仍显示等待状态和页面刷新入口，后续错误明确显示', async () => {
        useSettingStore().settings = {loginDomain: 1, loginOpacity: 1, pocketIdSwitch: 1, loginVerify: true, siteKey: 'test-site-key'}
        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
        document.head.append(script)
        script.dispatchEvent(new Event('error'))
        const host = mountLogin()
        await vi.waitFor(() => expect(host.querySelector('.turnstile-reload')).not.toBe(null))
        expect(host.querySelector('.turnstile-reload').href).toBe(window.location.href)
        expect(host.querySelector('[role="status"]').textContent).toContain('正在加载人机验证')
        script.dispatchEvent(new Event('error'))
        await vi.waitFor(() => expect(host.querySelector('[role="alert"]').textContent).toBe(zh.verifyModuleFailed))
        const turnstile = {render: vi.fn(() => 'login-widget'), reset: vi.fn(), remove: vi.fn(), ready: fn => fn()}
        vi.stubGlobal('turnstile', turnstile)
        script.dispatchEvent(new Event('load'))
        await vi.waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce())
        expect(host.querySelector('.turnstile-reload')).toBe(null)
        expect(host.querySelector('[role="status"]')).toBe(null)
        expect(host.querySelector('[role="alert"]')).toBe(null)
    })
})
