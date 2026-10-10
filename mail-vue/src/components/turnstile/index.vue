<template>
  <div class="turnstile-verification">
    <div ref="container"></div>
    <span v-if="!sdkReady && !loadError" role="status">{{ t('loadingVerification') }}</span>
    <span v-if="loadError" role="alert">{{ $t('verifyModuleFailed') }}</span>
    <a v-if="!sdkReady || loadError" class="turnstile-reload" :href="pageUrl">{{ t('reloadVerification') }}</a>
  </div>
</template>

<script setup>
import {onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {useI18n} from 'vue-i18n'

const {t} = useI18n({useScope: 'local', messages: {
  zh: {loadingVerification: '正在加载人机验证', reloadVerification: '刷新页面重新验证'},
  en: {loadingVerification: 'Loading verification', reloadVerification: 'Refresh page to retry'},
}})

const props = defineProps({siteKey: {type: String, required: true}, action: {type: String, required: true}})
const token = defineModel({type: String, default: ''})
const container = ref(null)
const loadError = ref(false)
const sdkReady = ref(false)
const pageUrl = window.location.href
let widgetId = null
let script = null

function render() {
  if (!container.value || !props.siteKey || widgetId !== null) return
  widgetId = window.turnstile.render(container.value, {
    sitekey: props.siteKey,
    action: props.action,
    size: 'flexible',
    callback: value => {
      loadError.value = false
      token.value = value
    },
    'expired-callback': () => { token.value = '' },
    'error-callback': fail,
  })
}

function fail() {
  loadError.value = true
  token.value = ''
}

function ready() {
  sdkReady.value = true
  loadError.value = false
  window.turnstile.ready(render)
}

function reset() {
  token.value = ''
  if (widgetId !== null) window.turnstile.reset(widgetId)
}

onMounted(() => {
  token.value = ''
  if (window.turnstile) {
    ready()
    return
  }
  script = document.querySelector('script[src="https://challenges.cloudflare.com/turnstile/v0/api.js"]')
  if (!script) {
    fail()
    return
  }
  script.addEventListener('load', ready)
  script.addEventListener('error', fail)
})

watch(() => props.siteKey, () => {
  reset()
  if (widgetId !== null) window.turnstile.remove(widgetId)
  widgetId = null
  if (window.turnstile) ready()
}, {flush: 'post'})

onBeforeUnmount(() => {
  script?.removeEventListener('load', ready)
  script?.removeEventListener('error', fail)
  if (widgetId !== null) window.turnstile.remove(widgetId)
})

defineExpose({reset})
</script>

<style scoped>
.turnstile-verification { margin-bottom: 18px; }
[role="alert"], [role="status"], .turnstile-reload { font-size: 12px; }
[role="alert"] { color: var(--el-color-danger); }
.turnstile-reload { display: block; margin-top: 6px; color: var(--el-color-primary); }
</style>
