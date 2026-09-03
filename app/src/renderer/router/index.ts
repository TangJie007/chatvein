import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/chat' },
  {
    path: '/chat',
    name: 'chat',
    component: () => import('../views/ChatView.vue'),
    meta: { module: '对话' },
  },
  {
    path: '/agents',
    name: 'agents',
    component: () => import('../views/AgentsView.vue'),
    meta: { module: 'Agents' },
  },
  {
    path: '/models',
    name: 'models',
    component: () => import('../views/ModelsView.vue'),
    meta: { module: '模型选型' },
  },
  {
    path: '/groups',
    name: 'groups',
    component: () => import('../views/GroupsView.vue'),
    meta: { module: '群组' },
  },
  {
    path: '/knowledge',
    name: 'knowledge',
    component: () => import('../views/KnowledgeView.vue'),
    meta: { module: '知识库' },
  },
  {
    path: '/mcp',
    name: 'mcp',
    component: () => import('../views/McpView.vue'),
    meta: { module: 'MCP' },
  },
  {
    path: '/skills',
    name: 'skills',
    component: () => import('../views/SkillsView.vue'),
    meta: { module: 'Skills' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
    meta: { module: '设置' },
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
