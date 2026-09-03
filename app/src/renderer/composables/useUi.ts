import { reactive } from 'vue'

/** Tiny shared UI state: breadcrumb item label + global source drawer. */
export const ui = reactive({
  crumbItem: '',
})

export function setCrumbItem(label: string) {
  ui.crumbItem = label
}
