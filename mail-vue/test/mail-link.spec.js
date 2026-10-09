import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createApp, h, nextTick} from 'vue'
import {createPinia, setActivePinia} from 'pinia'
import {createMemoryHistory, createRouter} from 'vue-router'
import {createI18n} from 'vue-i18n'
import {useEmailStore} from '@/store/email.js'
import {useUserStore} from '@/store/user.js'

const {emailDetail, emailRead} = vi.hoisted(() => ({emailDetail: vi.fn(), emailRead: vi.fn()}))
vi.mock('@/request/email.js', () => ({emailDetail, emailRead, emailDelete: vi.fn(), emailUnread: vi.fn()}))
vi.mock('@/axios/index.js', () => ({default: {}}))
vi.mock('@/utils/day.js', () => ({formatDetailDate: () => ''}))
vi.mock('@/components/shadow-html/index.vue', () => ({default: {props: ['html'], template: '<div>{{ html }}</div>'}}))
vi.mock('@iconify/vue', () => ({Icon: {template: '<span></span>'}}))

const {default: Content} = await import('@/views/content/index.vue')
const target = {emailId: 42, userId: 7, subject: '通知邮件', text: '通知正文', recipient: '[]', unread: 0, attList: []}
let app

async function mount(path = '/mail?id=42') {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useEmailStore()
    store.contentData.email = {emailId: 9, subject: '上次打开的邮件', text: '缓存正文', recipient: '[]'}
    store.contentData.showUnread = true
    store.currentEmailList = [{emailId: 9}, {emailId: 10}]
    useUserStore().user = {userId: 7, permKeys: ['*']}
    const router = createRouter({history: createMemoryHistory(), routes: [{path: '/mail', component: Content}]})
    await router.push(path)
    await router.isReady()
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({render: () => h(Content)})
    app.use(pinia).use(router).use(createI18n({legacy: false, locale: 'zh', missingWarn: false, fallbackWarn: false, messages: {zh: {}}}))
    app.directive('perm', {})
    app.directive('loading', {})
    app.component('el-scrollbar', {setup: (_, {slots}) => () => h('div', slots.default?.())})
    app.component('el-alert', {props: ['title'], template: '<div role="alert">{{ title }}</div>'})
    app.component('el-image-viewer', {template: '<div></div>'})
    app.mount(host)
    await nextTick()
    return {host, store, router}
}

describe('Open in Mail 链接', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        emailRead.mockResolvedValue(null)
        emailDetail.mockResolvedValue({...target})
    })

    afterEach(() => {
        app?.unmount()
        document.body.innerHTML = ''
    })

    it('按链接 ID 获取通知邮件，替换上次打开的邮件并标已读', async () => {
        const {host, store} = await mount()
        await vi.waitFor(() => expect(host.textContent).toContain('通知正文'))
        expect(emailDetail).toHaveBeenCalledWith('42')
        expect(host.textContent).not.toContain('上次打开的邮件')
        expect(store.contentData.email.emailId).toBe(42)
        expect(store.currentEmailList).toEqual([])
        expect(emailRead).toHaveBeenCalledWith([42])
    })

    it('详情加载期间立即清掉缓存，不显示或标已读旧邮件', async () => {
        emailDetail.mockReturnValue(new Promise(() => {}))
        const {host, store} = await mount()
        expect(host.textContent).not.toContain('缓存正文')
        expect(store.contentData.email).toBe(null)
        expect(emailRead).not.toHaveBeenCalled()
    })

    it('目标不存在或无权访问时显示错误，不退回缓存邮件', async () => {
        emailDetail.mockRejectedValue({message: '邮件不存在'})
        const {host, store} = await mount()
        await vi.waitFor(() => expect(host.textContent).toContain('邮件不存在'))
        expect(store.contentData.email).toBe(null)
        expect(host.textContent).not.toContain('缓存正文')
        expect(emailRead).not.toHaveBeenCalled()
    })

    it('切换链接后，较晚返回的旧请求不会覆盖新邮件', async () => {
        let resolveOld
        emailDetail.mockImplementationOnce(() => new Promise(resolve => {resolveOld = resolve}))
        emailDetail.mockResolvedValueOnce({...target, emailId: 43, subject: '下一封', text: '下一封正文'})
        const {host, store, router} = await mount()
        await router.replace('/mail?id=43')
        await vi.waitFor(() => expect(host.textContent).toContain('下一封正文'))
        resolveOld({...target})
        await nextTick()
        expect(store.contentData.email.emailId).toBe(43)
        expect(emailRead).not.toHaveBeenCalledWith([42])
    })

    it('管理员打开其他用户邮件时沿用管理详情的操作范围', async () => {
        emailDetail.mockResolvedValue({...target, userId: 8})
        const {store} = await mount()
        await vi.waitFor(() => expect(store.contentData.email.emailId).toBe(42))
        expect(store.contentData).toMatchObject({delType: 'physics', showReply: false, showStar: false, showUnread: false})
        expect(emailRead).not.toHaveBeenCalled()
    })

    it('从站内列表打开不带 ID 的详情仍展示已选择的邮件', async () => {
        const {host} = await mount('/mail')
        expect(host.textContent).toContain('缓存正文')
        expect(emailDetail).not.toHaveBeenCalled()
    })
})
