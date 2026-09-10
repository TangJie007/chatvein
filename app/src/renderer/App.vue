<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const crumbModule = computed(() => (route.meta.module as string) ?? '对话')

let offNavigate: (() => void) | undefined
onMounted(() => {

})
onUnmounted(() => offNavigate?.())
</script>

<template>
  <div
    class="relative grid h-screen w-screen overflow-hidden rounded-[22px] bg-[var(--color-canvas)] shadow-[var(--shadow-3)]"
    style="grid-template-rows: 52px 1fr; isolation: isolate"
  >
    <TitleBar :crumb-module="crumbModule" :crumb-item="ui.crumbItem || '工作台'" />
    <NoticeStack />

    <div class="grid min-h-0" style="grid-template-columns: 78px 300px 1fr">
      <NavRail />
      <RouterView v-slot="{ Component }">
        <component :is="Component" />
      </RouterView>
    </div>
  </div>
</template>
