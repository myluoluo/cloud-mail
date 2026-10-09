import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createApp, h} from 'vue'
import {createPinia, setActivePinia} from 'pinia'
import {createI18n} from 'vue-i18n'
import {useSettingStore} from '@/store/setting.js'
import zh from '@/i18n/zh.js'

const {oauthPocketIdLogin, oauthPocketIdAuthorize, loginUserInfo} = vi.hoisted(() => ({oauthPocketIdLogin: vi.fn(), oauthPocketIdAuthorize: vi.fn(), loginUserInfo: vi.fn()}))
vi.mock('@/request/ouath.js', () => ({oauthPocketIdLogin, oauthPocketIdAuthorize, oauthBindUser: vi.fn(), oauthGithubLogin: vi.fn(), oauthGoogleLogin: vi.fn(), oauthLinuxDoLogin: vi.fn()}))
vi.mock('@/request/my.js', () => ({loginUserInfo}))
vi.mock('@/request/login.js', () => ({login: vi.fn(), register: vi.fn()}))
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
    for (const name of ['el-input', 'el-dialog', 'el-select', 'el-option', 'el-avatar']) {
        app.component(name, {setup: (_, {slots}) => () => h('div', slots.default?.())})
    }
    app.mount(host)
    return host
}

describe('登录入口与通知链接跳转', () => {
    beforeEach(async () => {
        vi.clearAllMocks()
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
})
