<script lang="ts">
import { defineComponent, watch } from 'vue'

/** 把 Listbox slot 的 open 同步到父组件（避免在 template 里赋值） */
export default defineComponent({
  name: 'SelectOpenRelay',
  props: { open: { type: Boolean, required: true } },
  emits: ['change'],
  setup(props, { emit }) {
    watch(
      () => props.open,
      (v) => emit('change', v),
      { immediate: true },
    )
    return () => null
  },
})
</script>
