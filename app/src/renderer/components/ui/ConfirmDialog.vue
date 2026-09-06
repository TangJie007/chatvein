<script setup lang="ts">
import { Dialog, DialogPanel, DialogTitle, TransitionChild, TransitionRoot } from '@headlessui/vue'
import AppButton from './AppButton.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    /** busy 时确认按钮文案 */
    busyLabel?: string
    /** 危险操作（删除等）用红色确认按钮 */
    danger?: boolean
    busy?: boolean
  }>(),
  {
    confirmLabel: '确认',
    cancelLabel: '取消',
    busyLabel: '处理中…',
    danger: false,
    busy: false,
  },
)

const emit = defineEmits<{
  close: []
  confirm: []
}>()

function onClose() {
  if (props.busy) return
  emit('close')
}

function onConfirm() {
  if (props.busy) return
  emit('confirm')
}
</script>

<template>
  <TransitionRoot appear :show="open" as="template">
    <Dialog as="div" class="relative z-[40]" @close="onClose">
      <TransitionChild
        as="template"
        enter="duration-200 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-150 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-[rgb(43_44_48/0.28)] backdrop-blur-[2px]" aria-hidden="true" />
      </TransitionChild>

      <div class="fixed inset-0 overflow-y-auto">
        <div class="flex min-h-full items-center justify-center p-5">
          <TransitionChild
            as="template"
            enter="duration-220 ease-[var(--ease-soft)]"
            enter-from="opacity-0 translate-y-2 scale-[0.98]"
            enter-to="opacity-100 translate-y-0 scale-100"
            leave="duration-150 ease-in"
            leave-from="opacity-100 translate-y-0 scale-100"
            leave-to="opacity-0 translate-y-1 scale-[0.98]"
          >
            <DialogPanel
              class="w-full max-w-[400px] rounded-[18px] bg-[var(--color-elevated)] p-5 shadow-[var(--shadow-3)]"
              :aria-busy="busy || undefined"
            >
              <DialogTitle class="m-0 text-[15px] font-semibold leading-snug text-[var(--color-ink-1)]">
                {{ title }}
              </DialogTitle>
              <p
                v-if="description"
                class="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-[var(--color-ink-2)]"
              >
                {{ description }}
              </p>

              <div class="mt-5 flex items-center justify-end gap-2">
                <AppButton variant="ghost" size="sm" :disabled="busy" @click="onClose">
                  {{ cancelLabel }}
                </AppButton>
                <AppButton
                  :variant="danger ? 'danger' : 'primary'"
                  size="sm"
                  :disabled="busy"
                  @click="onConfirm"
                >
                  <span
                    v-if="busy"
                    class="confirm-spinner"
                    :class="danger ? 'confirm-spinner--on-danger' : 'confirm-spinner--on-primary'"
                    aria-hidden="true"
                  />
                  {{ busy ? busyLabel : confirmLabel }}
                </AppButton>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<style scoped>
.confirm-spinner {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 1.5px solid transparent;
  animation: confirm-spin 0.7s linear infinite;
  flex-shrink: 0;
}
.confirm-spinner--on-primary,
.confirm-spinner--on-danger {
  border-top-color: rgb(255 255 255 / 0.95);
  border-right-color: rgb(255 255 255 / 0.35);
  border-bottom-color: rgb(255 255 255 / 0.35);
  border-left-color: rgb(255 255 255 / 0.35);
}
@keyframes confirm-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .confirm-spinner {
    animation: none;
    opacity: 0.85;
  }
}
</style>
