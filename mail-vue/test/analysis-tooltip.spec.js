import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createApp, h} from 'vue'
import {createPinia} from 'pinia'
import {createI18n} from 'vue-i18n'
import Analysis from '@/views/analysis/index.vue'

const {options, analysisEcharts} = vi.hoisted(() => ({options: new Map(), analysisEcharts: vi.fn()}))
// 只隔离统计接口和 Canvas 图表运行时，读取真实组件交给图表的配置。
vi.mock('@/request/analysis.js', () => ({analysisEcharts}))
vi.mock('@/echarts/index.js', () => ({default: {
    init: element => ({
        setOption: option => options.set(element.className, option), dispose() {},
        getModel: () => ({getComponent: () => ({axis: {scale: {getExtent: () => [0, 3]}}})}),
    }),
    graphic: {LinearGradient: class {}},
}}))
vi.mock('vue-router', () => ({useRoute: () => ({name: 'analysis'})}))
vi.mock('@vueuse/core', () => ({useTransition: value => value}))
vi.mock('@iconify/vue', () => ({Icon: {render: () => null}}))

let app

beforeEach(() => {
    options.clear()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({measureText: text => ({width: text.length})})
})

afterEach(() => {
    app?.unmount()
    app = null
    window.onresize = null
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

async function senderTooltip(name) {
    analysisEcharts.mockResolvedValue({
        numberCount: {}, receiveRatio: {nameRatio: [{name, total: 3}]},
        userDayCount: [], emailDayCount: {receiveDayCount: [], sendDayCount: []}, daySendTotal: 0,
    })
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({render: () => h(Analysis)})
    app.use(createPinia())
    app.use(createI18n({legacy: false, locale: 'zh', missingWarn: false, fallbackWarn: false, messages: {zh: {}}}))
    app.component('el-scrollbar', {render() {return h('div', this.$slots.default?.())}})
    app.component('el-statistic', {render: () => null})
    for (const name of ['el-radio-button', 'el-radio-group', 'el-icon']) {
        app.component(name, {render: () => null})
    }
    app.mount(host)
    await vi.waitFor(() => expect(options.has('sender-pie')).toBe(true), {timeout: 1000})
    const option = options.get('sender-pie')
    const tooltip = document.createElement('div')
    tooltip.innerHTML = option.tooltip.formatter({
        ...option.series[0].data[0], marker: '<span class="chart-marker"></span>', percent: 75,
    })
    return tooltip
}

describe('发件来源统计提示框', () => {
    it('邮件头中的标记按文字显示，不能成为 HTML 元素', async () => {
        const name = '<b data-audit="sender">发件人</b> & "别名"'
        const tooltip = await senderTooltip(name)
        expect(tooltip.querySelector('[data-audit]')).toBeNull()
        expect(tooltip.textContent).toBe(` ${name}： 3 (75%)`)
        expect(tooltip.querySelector('.chart-marker')).not.toBeNull()
    })

    it('普通名称和统计数字保持原样', async () => {
        const tooltip = await senderTooltip('张三 & Co.')
        expect(tooltip.textContent).toBe(' 张三 & Co.： 3 (75%)')
    })
})
