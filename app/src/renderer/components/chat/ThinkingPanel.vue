<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '../AppIcon.vue'
import DisclosureSection from '../ui/DisclosureSection.vue'
import type { TraceStep } from './AgentTrace.vue'

export interface ThinkingArtifact {
  id: string
  title: string
  /** 如 file / script / report */
  kind?: string
  detail?: string
}

const props = withDefaults(
  defineProps<{
    active?: boolean
    phase?: 'thinking' | 'answering'
    agent?: string
    thought?: string
    steps?: TraceStep[]
    artifacts?: ThinkingArtifact[]
  }>(),
  {
    active: false,
    phase: 'thinking',
    agent: '',
    thought: '',
    steps: () => [],
    artifacts: () => [],
  },
)

const thoughtBodyRef = ref<HTMLElement | null>(null)
/** remount Disclosure 以在新一轮强制 defaultOpen */
const thoughtKey = ref(0)
const artifactsKey = ref(0)

const phaseLabel = computed(() =>
  props.phase === 'thinking' ? '思考中' : '已思考 · 生成正文',
)

const thoughtBadge = computed(() =>
  props.active && props.phase === 'thinking' ? 'live' : '',
)

const artifactBadge = computed(() => String(props.artifacts.length))

watch(
  () => props.active,
  (on, was) => {
    if (on && !was) thoughtKey.value += 1
  },
)

watch(
  () => props.artifacts.length,
  (n, prev) => {
    if (n > 0 && (prev === 0 || prev === undefined)) artifactsKey.value += 1
  },
)

watch(
  () => props.thought,
  async () => {
    await nextTick()
    const el = thoughtBodyRef.value
    if (el) el.scrollTop = el.scrollHeight
  },
)
</script>

<template>
  <aside
    class="flex h-full min-h-0 w-[260px] shrink-0 flex-col bg-[var(--color-elevated)] shadow-[inset_1px_0_0_rgba(223,227,232,0.8)]"
    aria-label="AI 思考与产物"
  >
    <div class="flex items-center gap-2 px-4 pb-3 pt-[18px]">
      <span
        class="h-[7px] w-[7px] shrink-0 rounded-full"
        :class="active && phase === 'thinking' ? 'bg-[var(--color-brand)] dot-thinking' : 'bg-[var(--color-ink-4)]'"
      />
      <div class="min-w-0">
        <div class="text-[13px] font-semibold leading-tight text-[var(--color-ink-1)]">运行侧栏</div>
        <div class="mt-[2px] truncate font-mono text-[10.5px] text-[var(--color-ink-3)]">
          {{ agent || 'Agent' }} · {{ phaseLabel }}
        </div>
      </div>
      <span
        v-if="active && phase === 'thinking'"
        class="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-brand-soft)] px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.4px] text-[var(--color-brand-dark)]"
      >
        <span class="h-[5px] w-[5px] rounded-full bg-[var(--color-brand)] dot-thinking" />
        live
      </span>
    </div>

    <div class="scroll-thin flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 pb-2">
      <DisclosureSection
        :key="`thought-${thoughtKey}`"
        title="思考流"
        :badge="thoughtBadge"
        :default-open="true"
        panel-class="max-h-[min(52vh,420px)]"
      >
        <div ref="thoughtBodyRef" class="flex flex-col gap-2">
          <p
            class="m-0 whitespace-pre-wrap rounded-[10px] bg-[var(--color-elevated)] px-2.5 py-2 text-[12px] leading-[1.65] shadow-[inset_0_0_0_1px_rgba(223,227,232,0.55)]"
            :class="phase === 'answering' ? 'text-[var(--color-ink-3)]' : 'text-[var(--color-ink-2)]'"
          >
            <template v-if="thought">{{ thought }}</template>
            <span v-else-if="active" class="inline-flex items-center gap-1.5 text-[var(--color-ink-3)]">
              <span class="h-[6px] w-[6px] rounded-full bg-[var(--color-brand)] dot-thinking" />
              正在梳理思路…
            </span>
            <span v-else class="text-[var(--color-ink-3)]">发送消息后，这里会实时显示推理过程。</span>
          </p>

          <template v-if="steps.length">
            <div class="px-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.6px] text-[var(--color-ink-3)]">
              行动轨迹
            </div>
            <div
              v-for="(s, i) in steps"
              :key="i"
              class="grid grid-cols-[20px_1fr] items-start gap-2 rounded-[10px] px-1.5 py-1.5"
              :class="
                i === steps.length - 1
                  ? 'bg-[var(--color-brand-soft)] shadow-[inset_0_0_0_1px_rgb(97_120_208/0.28)]'
                  : ''
              "
            >
              <div
                class="mt-[1px] grid h-[20px] w-[20px] shrink-0 place-items-center rounded-[6px] font-mono text-[10px] font-semibold"
                :class="
                  s.kind === 'ok'
                    ? 'bg-[#7fbfa8]/[0.18] text-[var(--color-ok-ink)]'
                    : s.kind === 'tool'
                      ? 'bg-[#6c81d2]/[0.16] text-[var(--color-info-ink)]'
                      : 'bg-[var(--color-hover)] text-[var(--color-brand-deep)]'
                "
              >
                <AppIcon v-if="active && i === steps.length - 1" name="activity" :size="11" :stroke-width="2.2" />
                <template v-else>{{ s.icon }}</template>
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="truncate font-mono text-[11px] font-semibold text-[var(--color-ink-1)]">{{ s.name }}</span>
                  <span class="ml-auto shrink-0 font-mono text-[10px] text-[var(--color-ink-3)]">{{ s.tag }}</span>
                </div>
                <p class="m-0 mt-[3px] text-[11.5px] leading-[1.5] text-[var(--color-ink-2)]">{{ s.detail }}</p>
              </div>
            </div>
          </template>
        </div>
      </DisclosureSection>

      <DisclosureSection
        :key="`artifacts-${artifactsKey}-${artifacts.length ? 'has' : 'empty'}`"
        title="产物"
        :badge="artifactBadge"
        :default-open="artifacts.length > 0"
        panel-class="max-h-[min(40vh,320px)]"
      >
        <template v-if="artifacts.length">
          <div
            v-for="a in artifacts"
            :key="a.id"
            class="rounded-[10px] bg-[var(--color-elevated)] px-2.5 py-2 shadow-[inset_0_0_0_1px_rgba(223,227,232,0.55)]"
          >
            <div class="flex items-center gap-1.5">
              <AppIcon name="folder" :size="12" :stroke-width="2" class="shrink-0 text-[var(--color-ink-3)]" />
              <span class="truncate text-[12px] font-semibold text-[var(--color-ink-1)]">{{ a.title }}</span>
              <span
                v-if="a.kind"
                class="ml-auto shrink-0 rounded-md bg-[var(--color-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-ink-3)]"
              >{{ a.kind }}</span>
            </div>
            <p v-if="a.detail" class="m-0 mt-1 text-[11.5px] leading-[1.45] text-[var(--color-ink-2)]">{{ a.detail }}</p>
          </div>
        </template>
        <p v-else class="m-0 px-0.5 py-1 text-[11.5px] leading-[1.5] text-[var(--color-ink-3)]">
          会话工作区暂无文件。脚本、导出等会出现在这里。
        </p>
      </DisclosureSection>
    </div>

    <div class="shrink-0 px-4 pb-3.5 pt-2.5 shadow-[inset_0_1px_0_rgba(223,227,232,0.8)]">
      <div class="truncate font-mono text-[10.5px] text-[var(--color-ink-3)]">
        <template v-if="active">
          {{ phase === 'thinking' ? '推理内容来自模型 reasoning 字段' : '思考完成，正文生成中' }}
        </template>
        <template v-else>空闲 · 等待下一轮对话</template>
      </div>
    </div>
  </aside>
</template>
