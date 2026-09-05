<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { renderMarkdown } from '../../lib/markdown'

const props = withDefaults(
  defineProps<{
    text: string
    /** 流式中：rAF 节流 + 配对符补全；定稿后立即全量渲染 */
    streaming?: boolean
  }>(),
  { streaming: false },
)

const html = ref('')
let raf = 0

function render() {
  html.value = renderMarkdown(props.text, { streaming: props.streaming })
}

watch(
  () => [props.text, props.streaming] as const,
  () => {
    if (props.streaming) {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(render)
    } else {
      cancelAnimationFrame(raf)
      render()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="md-body" :class="{ 'md-body--streaming': streaming }" v-html="html" />
</template>
