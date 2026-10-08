<template>
  <div class="content-box" ref="contentBox">
    <div class="remote-bar" v-if="blockedRemoteCount > 0">
      <span>{{ $t('remoteContentBlocked') }}</span>
      <el-button link type="primary" size="small" @click="showRemoteContent">{{ $t('showRemoteContent') }}</el-button>
    </div>
    <div ref="container" class="content-html"></div>
  </div>
</template>

<script setup>
import {ref, onMounted, watch} from 'vue'
import {buildEmailContent} from '@/utils/email-html.js'
import {useSettingStore} from '@/store/setting.js'
import {toOssDomain} from '@/utils/convert.js'

const props = defineProps({
  html: {
    type: String,
    required: true
  }
})

const settingStore = useSettingStore()
const container = ref(null)
const contentBox = ref(null)
const blockedRemoteCount = ref(0)
const showRemote = ref(false)
let shadowRoot = null

// 静态外壳样式，不再拼接邮件内容，避免邮件样式逃逸成页面样式
const SHADOW_STYLE = `
    :host {
      all: initial;
      width: 100%;
      height: 100%;
      font-family: Inter, 'Helvetica Neue', Helvetica, 'PingFang SC',
                  'Hiragino Sans GB', 'Microsoft YaHei', '微软雅黑', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #13181D;
      word-break: break-word;
    }

    h1, h2, h3, h4 {
        font-size: 18px;
        font-weight: 700;
    }

    p {
      margin: 0;
    }

    a {
      text-decoration: none;
      color: #0E70DF;
    }

    .shadow-content {
      background: #FFFFFF;
      width: fit-content;
      height: fit-content;
      min-width: 100%;
    }

    img:not(table img) {
      max-width: 100%;
      height: auto !important;
    }
`

function allowedOrigins() {
  const ossDomain = toOssDomain(settingStore.settings.r2Domain)
  return ossDomain ? [ossDomain] : []
}

function updateContent() {
  if (!shadowRoot) return

  const content = buildEmailContent(props.html, {
    allowRemote: showRemote.value,
    allowedOrigins: allowedOrigins(),
  })
  blockedRemoteCount.value = content.blockedRemoteCount

  const style = document.createElement('style')
  style.textContent = SHADOW_STYLE

  const body = document.createElement('div')
  body.className = 'shadow-content'
  if (content.bodyStyle) body.setAttribute('style', content.bodyStyle)
  body.innerHTML = content.html

  shadowRoot.replaceChildren(style, body)
  autoScale()
}

function showRemoteContent() {
  showRemote.value = true
  updateContent()
}

function autoScale() {
  if (!shadowRoot || !contentBox.value) return

  const parent = contentBox.value
  const shadowContent = shadowRoot.querySelector('.shadow-content')

  if (!shadowContent) return

  const parentWidth = parent.offsetWidth
  const childWidth = shadowContent.scrollWidth

  if (childWidth === 0) return

  const scale = parentWidth / childWidth

  const hostElement = shadowRoot.host
  hostElement.style.zoom = scale
}

onMounted(() => {
  shadowRoot = container.value.attachShadow({ mode: 'open' })
  updateContent()
})

watch(() => props.html, () => {
  // 换一封邮件要重新拦截远程内容
  showRemote.value = false
  updateContent()
})
</script>

<style scoped>
.content-box {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: Inter, "Helvetica Neue", Helvetica, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", Arial, sans-serif;
}

.remote-bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  padding: 2px 10px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.content-html {
  flex: 1;
  min-height: 0;
  width: 100%;
}
</style>
