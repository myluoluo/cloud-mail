import {afterEach, expect, it, vi} from 'vitest'
import {createPinia, setActivePinia} from 'pinia'

// 模拟新标签页，在 app.use(router) 前先执行真实 init/axios 的登录失效路径。
vi.mock('@/layout/index.vue', () => ({default: {template: '<div></div>'}}))

afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
})

it('启动时凭证过期并跳转登录，仍保留地址栏中的通知邮件 ID', async () => {
    setActivePinia(createPinia())
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('token', 'expired-token')
    window.history.replaceState({}, '', '/mail?id=42')
    vi.stubGlobal('ElMessage', vi.fn())
    const {default: http} = await import('@/axios/index.js')
    const {default: router} = await import('@/router/index.js')
    const {init} = await import('@/init/init.js')
    http.defaults.adapter = async config => ({
        config, status: 200, statusText: 'OK', headers: {},
        data: config.url === '/my/loginUserInfo'
            ? {code: 401, message: '登录已过期'}
            : {code: 200, data: {domainList: [], title: 'Mail'}},
    })

    expect(router.currentRoute.value.name).toBeUndefined()
    await init()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
    expect(localStorage.getItem('token')).toBe(null)
    expect(sessionStorage.getItem('mailRedirectId')).toBe('42')
})
