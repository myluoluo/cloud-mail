import {afterEach, describe, expect, it, vi} from 'vitest'
import {createApp, h} from 'vue'
import {createPinia} from 'pinia'
import {createI18n} from 'vue-i18n'
import Setting from '@/views/setting/index.vue'

const {resetPassword, push} = vi.hoisted(() => ({resetPassword: vi.fn(), push: vi.fn()}))
vi.mock('@/request/my.js', () => ({resetPassword, userDelete: vi.fn()}))
vi.mock('@/router/index.js', () => ({default: {push}}))
let app

afterEach(() => {
    app?.unmount()
    document.body.innerHTML = ''
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('自助改密后重新登录', () => {
    it('成功改密后清除当前令牌并跳到登录页', async () => {
        resetPassword.mockResolvedValue()
        vi.stubGlobal('ElMessage', vi.fn())
        localStorage.setItem('token', 'old-session')
        const host = document.createElement('div')
        document.body.append(host)
        app = createApp({render: () => h(Setting)})
        app.use(createPinia()).use(createI18n({legacy: false, locale: 'zh', missingWarn: false, fallbackWarn: false, messages: {zh: {}}}))
        app.directive('perm', {})
        app.component('el-input', {
            props: ['modelValue'], emits: ['update:modelValue'],
            setup: (props, {emit}) => () => h('input', {value: props.modelValue,
                onInput: event => emit('update:modelValue', event.target.value)}),
        })
        for (const name of ['el-button', 'el-dialog', 'el-select', 'el-option']) {
            app.component(name, {setup: (_, {slots}) => () => h(name === 'el-button' ? 'button' : 'div', slots.default?.())})
        }
        app.mount(host)
        for (const input of host.querySelectorAll('.update-pwd input')) {
            input.value = 'new-password'
            input.dispatchEvent(new Event('input', {bubbles: true}))
        }
        host.querySelector('.update-pwd button').click()
        await vi.waitFor(() => expect(resetPassword).toHaveBeenCalledWith('new-password'))
        await vi.waitFor(() => expect(localStorage.getItem('token')).toBeNull())
        expect(push).toHaveBeenCalledWith('/login')
    })
})
