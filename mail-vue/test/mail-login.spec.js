import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createApp, h} from 'vue'
import {createPinia, setActivePinia} from 'pinia'
import {createI18n} from 'vue-i18n'
import {useSettingStore} from '@/store/setting.js'

const {oauthPocketIdLogin, loginUserInfo} = vi.hoisted(() => ({oauthPocketIdLogin: vi.fn(), loginUserInfo: vi.fn()}))
vi.mock('@/request/ouath.js', () => ({oauthPocketIdLogin, oauthPocketIdAuthorize: vi.fn(), oauthBindUser: vi.fn(), oauthGithubLogin: vi.fn(), oauthGoogleLogin: vi.fn(), oauthLinuxDoLogin: vi.fn()}))
vi.mock('@/request/my.js', () => ({loginUserInfo}))
vi.mock('@/request/login.js', () => ({login: vi.fn(), register: vi.fn()}))
vi.mock('@/request/setting.js', () => ({websiteConfig: vi.fn().mockResolvedValue({domainList: []})}))
vi.mock('@/layout/index.vue', () => ({default: {template: '<div></div>'}}))
vi.mock('@iconify/vue', () => ({Icon: {template: '<span></span>'}}))
const {default: router} = await import('@/router/index.js')
const {default: Login} = await import('@/views/login/index.vue')
let app
let pinia

describe('通知链接的登录跳转', () => {
    beforeEach(async () => {
        vi.clearAllMocks()
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
        const host = document.createElement('div')
        document.body.append(host)
        app = createApp({render: () => h(Login)})
        app.use(pinia).use(router).use(createI18n({legacy: false, locale: 'zh', missingWarn: false, fallbackWarn: false, messages: {zh: {}}}))
        app.directive('loading', {})
        for (const name of ['el-input', 'el-button', 'el-dialog', 'el-select', 'el-option', 'el-avatar']) {
            app.component(name, {setup: (_, {slots}) => () => h('div', slots.default?.())})
        }
        app.mount(host)
        await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('content'))
        expect(router.currentRoute.value.query.id).toBe('42')
        expect(sessionStorage.getItem('mailRedirectId')).toBe(null)
        expect(oauthPocketIdLogin).toHaveBeenCalledWith('test-code', 'test-state', `${window.location.origin}/login`)
    })
})
