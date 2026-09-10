import { reactive } from 'vue'

export interface Notice {
  id: number
  text: string
  tone: 'info' | 'error'
}

let seq = 0

/** 极简 UI 状态：面包屑文案 + 顶部提示条。 */
export const ui = reactive({
  crumbItem: '工作台',
  notices: [] as Notice[],

  notify(text: string, tone: Notice['tone'] = 'info'): void {
    const id = ++seq
    ui.notices.push({ id, text, tone })
    window.setTimeout(() => ui.dismiss(id), 2600)
  },

  dismiss(id: number): void {
    const index = ui.notices.findIndex((n) => n.id === id)
    if (index >= 0) ui.notices.splice(index, 1)
  },
})
