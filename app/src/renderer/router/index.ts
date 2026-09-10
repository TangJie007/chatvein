import { createRouter, createWebHashHistory } from 'vue-router'
import ChatView from '@/views/ChatView.vue'
import SettingsView from '@/views/SettingsView.vue'

export interface NavItem {
  path: string
  label: string
  /** 24x24 stroke 图标路径（配合 AppIcon 渲染） */
  icon: string
}

/** 左侧导航栏条目，NavRail 与路由共用同一份配置。 */
export const NAV_ITEMS: NavItem[] = [
  {
    path: '/chat',
    label: '对话',
    icon: 'M20 15a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z',
  },
  {
    path: '/settings',
    label: '设置',
    icon: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  },
]

export const router = createRouter({
  // Electron 生产环境走 file://，必须用 hash history
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/chat' },
    {
      path: '/chat',
      name: 'chat',
      component: ChatView,
      meta: { module: '对话' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
      meta: { module: '设置' },
    },
  ],
})
