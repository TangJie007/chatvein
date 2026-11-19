# 前端文件地图（`src/`）

> 技术栈：React 18 + TypeScript + Vite + Tailwind v4 + Radix/shadcn + streamdown。
> 读法：先看 `api/` 找请求，再搜函数名回到组件；页面状态基本是组件内 `useState`，没有全局 store。

## 1. 入口与路由

| 文件 | 职责 | 关键符号 / 依赖 |
|---|---|---|
| `src/main.tsx` | 应用挂载：HashRouter、ErrorBoundary、BackendGate、EmbeddingProvider | `createRoot`、`HashRouter` |
| `src/App.tsx` | 路由表 + 主布局 + 侧栏计数 + 更新检查 + 全局 `BashApproval` | 路由：`/chat/:conversationId?`、`/groups`、`/knowledge`、`/skills`、`/roles`、`/models`、`/settings/:section`、`/trace/:conversationId` |
| `src/types/view.ts` | 视图枚举与路径映射 | `AppView`、`VIEW_PATH`、`viewFromPathname` |
| `src/styles.css` | Tailwind v4 主题令牌（颜色/阴影/字体） | `@theme`、`surface`、`ink-*`、`brand-*`、`shadow-lift` |
| `src/vite-env.d.ts` | Vite 类型声明 | — |
| `index.html` | 入口 HTML | — |

## 2. API 层（`src/api/`）

**规则：组件不允许直接 `fetch`，所有后端请求走这里，并由 `index.ts` 桶导出。**

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `client.ts` | 请求底座：后端 URL/token、超时、重试、掉线广播 | `backendRequest`、`waitForBackend`、`getBackendUrl`、`getBackendToken`、`markBackendReady`、`markBackendLost`、`onBackendLost`、`RequestTimeoutError` |
| `conversations.ts` | 会话/消息/群成员/技能/工作区/产物 | `sendChat`（长请求 `timeoutMs: 0`）、`cancelChat`、`deleteLastTurn`、`listConversations`、`getConversation`、`createConversation`、`deleteConversation`、`clearHistory`、`updateConversationRole`、`updateConversationSkills`、`registerGroupMembers`、`getGroupMembers`、`getConversationWorkspace`、`openConversationWorkspace`、`openArtifactLocation` |
| `traces.ts` | 每轮追踪 | `listTraces`、`getTrace`；`TurnTrace` / `TraceStep` 类型 |
| `mcps.ts` | 工具目录 + Bash 审批 | `mcpCatalog`、`listBashPending`、`approveBash`、`denyBash` |
| `models.ts` | 模型 CRUD + 连通性测试 | `listModels`、`createModel`、`updateModel`、`deleteModel`、`testModelConnection` |
| `roles.ts` | 角色 CRUD | `listRoles`、`getRole`、`createRole`、`updateRole`、`deleteRole`；`RoleRecord`、`RoleTone` |
| `skills.ts` | 技能市场 / 已安装 / 安装卸载 | `listSkills`、`listInstalledSkills`、`getSkill`、`installSkill`、`uninstallSkill` |
| `knowledge.ts` | 知识库文档 / 搜索 / 导入 / 重建 | `getKbStatus`、`listKbDocs`、`getKbDoc`、`createKbDoc`、`updateKbDoc`、`deleteKbDoc`、`searchKb`、`importKbDocs`、`rebuildKbIndex`、`clearKb` |
| `embeddings.ts` | 向量模型状态/下载 | `getEmbeddingStatus`、`prepareEmbedding` |
| `db.ts` | 健康、上传、主空间、数据库维护 | `backendHealth`、`uploadFiles`、`getWorkspace`、`setWorkspace`、`resetWorkspace`、`dbInfo`、`listDbTables`、`getDbTableDetail`、`dbVacuum`、`dbBackup` |
| `index.ts` | 统一导出（新增 api 文件必须在此登记） | `export * from "./xxx"` |

## 3. 页面（`src/components/views/`）

| 文件 | 职责 | 关键依赖 |
|---|---|---|
| `ChatView.tsx` | 会话页：左会话列表 + 头部角色/模型 + Composer + 右 Insight | `SessionList`、`ChatPanel`、`Composer`、`InsightPanel`、`useChatSession`、`RolePickerDialog`、`CreatingOverlay` |
| `GroupView.tsx` | 群组页：本地群组 + 成员角色 + 群会话；建群/删除 | `lib/groupsStore`、`group/GroupList`、`group/GroupChat`、`group/CreateGroupDialog`、`GroupChatView` |
| `GroupChatView.tsx` | 群内对话：`ChatPanel` 的 group 变体（不显示模型/技能，用量在气泡上） | `useChatSession({ groupMemberIds })`、`insightData`、`lib/tokens` |
| `KnowledgeView.tsx` | 知识库：状态、文档列表/编辑、导入、重建/清空 | `api/knowledge`、`knowledge/KbDocEditor`、`knowledge/KbImportDialog` |
| `SkillsView.tsx` | 技能市场：搜索/分类/分页/安装/已安装标记/详情 | `api/skills`、`skills/SkillDetailDrawer`、`lib/openExternal` |
| `RolesView.tsx` | 角色管理：列表 + 配置面板 + 新建/删除 | `views/roles/RoleConfigPanel`、`RoleListSidebar`、`roleForm`、`lib/rolesStore` |
| `ModelsView.tsx` | 模型管理：列表、新增、测试 | `models/AddModelDialog`、`api/models` |
| `SettingsView.tsx` | 设置页：分区路由 + 预览/保存 | `settings/AppSection`、`McpSection`、`SqliteSection`、`UpdateSection`、`settings/prefs` |
| `roles/RoleConfigPanel.tsx` | 角色详情表单：名称/头像/模型/提示词/温度/记忆/工具/常驻技能 | `formFields`、`ModelSelect`、`ResidentSkillPicker`、`TryRunDialog` |
| `roles/RoleListSidebar.tsx` | 角色列表 + 新建入口 | `roleForm` |
| `roles/roleForm.ts` | 角色表单 ↔ 后端 payload 映射 | `makeNewRole`、`toUpdatePayload` |
| `roles/formFields.tsx` | 角色表单字段小组件 | — |
| `roles/ModelSelect.tsx` | 模型下拉 | `api/models` |
| `roles/ResidentSkillPicker.tsx` | 常驻技能勾选 | `api/skills` |
| `roles/TryRunDialog.tsx` | 角色试跑对话 | `api/conversations` |
| `roles/tone.ts` | 头像色板 | `RoleTone` |

## 4. 对话组件（`src/components/chat/`）

| 文件 | 职责 | 关键符号 |
|---|---|---|
| `useChatSession.ts` | **会话引擎**：加载消息、流式发送、取消/撤回/编辑恢复、乐观气泡、失败清理、技能、群成员透传、在途追踪轮询 | `useChatSession`、`toChatMessages`、`toLiveSteps`、`ChatSessionMeta`；返回 `messages/workspace/sending/error/errorTone/errorAnchorId/pendingQuestion/liveSteps/restoreText/onRestored/skills/meta/send/cancel` |
| `ChatPanel.tsx` | 消息列表与气泡渲染：模型条、上下文用量、错误挂载、产物、思考流入口 | `ChatPanel`、`ChatMessage`、`MemberAvatar` |
| `Composer.tsx` | 输入区：附件上传、技能选择、@ 成员、发送/停止、快捷键 | `Composer`、`ComposerSkill` |
| `InsightPanel.tsx` | 右侧「思考流 / 工具调用 / 产物」面板 | `InsightPanel`、`InsightStep` |
| `insightData.ts` | 把 trace payload 归一成思考线程与产物 | `buildInsightThread`、`buildInsightArtifacts` |
| `MarkdownMessage.tsx` | Markdown/代码块渲染（streamdown） | `MarkdownMessage` |
| `mentions.ts` | @ 解析：文本分段、成员 id、正则转义 | `MentionSegment`、`parseMentionSegments`、`parseMentionIds`、`escapeRegExp`、`MemberAvatar` |
| `MentionText.tsx` | @ 文本高亮渲染 | `MentionText` |
| `SessionList.tsx` | 左栏会话列表 + 预览映射 | `SessionList`、`SessionItem`、`toSessionItem` |
| `RolePickerDialog.tsx` | 会话角色选择弹窗 | `RolePickerDialog` |
| `CreatingOverlay.tsx` | 「正在创建」多步骤遮罩 | `CreatingOverlay`、`lib/creationSteps` |
| `WaitingBubble.tsx` | 等待/生成占位气泡 | `WaitingBubble` |
| `BashApproval.tsx` | 全局 Bash 审批弹窗：轮询 `/api/bash/pending`，允许/拒绝 | `BashApproval`、`api/mcps` |
| `useChatSession.test.ts` | 会话引擎单测（撤回/停止/乐观更新） | vitest |

## 5. 群组 / 知识库 / 技能 / 模型小组件

| 文件 | 职责 |
|---|---|
| `group/GroupChat.tsx` | 群聊面板（群成员头像/@ 指派） |
| `group/GroupList.tsx` | 群组左栏（群名、成员、预览） |
| `group/CreateGroupDialog.tsx` | 建群弹窗（名称 + 成员） |
| `group/PickerOptionList.tsx` | 通用成员/角色选择列表 |
| `knowledge/KbDocEditor.tsx` | 知识文档编辑（标题/正文/标签） |
| `knowledge/KbImportDialog.tsx` | 批量导入（文件/粘贴） |
| `skills/SkillDetailDrawer.tsx` | 技能详情抽屉（SKILL.md 预览、安装） |
| `models/AddModelDialog.tsx` | 新增模型（provider/base_url/api_key/参数） |

## 6. 布局 / 基础设施

| 文件 | 职责 |
|---|---|
| `layout/BackendGate.tsx` | 等后端就绪：监听 `backend-ready` / `backend-error`、轮询 `backendHealth`、获取 URL/token；失败显示重试 |
| `layout/TitleBar.tsx` | 自定义标题栏：拖拽区、最小化/最大化/关闭、更新提示 |
| `layout/Sidebar.tsx` | 主导航与计数（会话/群组/技能等） |
| `layout/CenterHint.tsx` | 居中提示/加载 |
| `layout/ErrorBoundary.tsx` | 顶层错误边界 |
| `embedding/EmbeddingProvider.tsx` | 向量模型状态上下文：`getEmbeddingStatus` / `prepareEmbedding` 轮询，供知识库页使用 |
| `trace/TraceWindow.tsx` | 独立追踪窗口（`/trace/:conversationId`）：轮次列表 + span 树 + payload |
| `trace/JsonBlock.tsx` | JSON/参数折叠展示 |
| `ui/*.tsx` | Radix/shadcn 基础组件：button、input、dialog、select、sheet、tooltip、scroll-area、switch、slider、badge、avatar-picker 等 |
| `ui/index.ts` | UI 组件桶导出 |

## 7. 工具库（`src/lib/`）

| 文件 | 职责 | 关键符号 |
|---|---|---|
| `cn.ts` | className 合并 | `cn` |
| `errors.ts` | 统一错误文案 | `errorMessage` |
| `tokens.ts` | token 估算/格式化/上下文占用 | `estimateTokens`、`formatTokenCount`、`contextUsage` |
| `rolesStore.ts` | 角色头像/工具集辅助，不做持久化 | `AVATAR_URLS`、`avatarUrl`、`TOOLSET`、`DEFAULT_ENABLED_TOOLS`、`makeNewRole` |
| `groupsStore.ts` | 群组 localStorage 持久化（后端无群组表） | `loadGroups`、`saveGroups`、`makeGroup`、`ChatGroup` |
| `creationSteps.ts` | 创建会话/群组的步骤动画常量 | `CREATE_STEPS`、`CREATE_MIN_MS`、`sleep` |
| `openExternal.ts` | 用系统浏览器打开链接（Tauri opener，浏览器 fallback） | `openExternal` |
| `openTrace.ts` | 打开独立追踪窗口/路由 | `openTraceWindow` |
| `updater.ts` | Tauri 更新检查/下载/安装 | `isTauri`、`currentVersion`、`checkForUpdate`、`downloadAndInstall` |

## 8. 前端硬约定

1. **请求只经 `api/`**：`backendRequest` 负责 token、超时、重试、backend-lost；页面里不要 `fetch`。
2. **长对话请求**：`sendChat` 使用 `timeoutMs: 0` + `AbortController`；`停止` 必须同时调 `cancelChat(turnId)`，否则后端继续跑。
3. **错误三分**：用户停止（`AbortError` / Tauri `Request canceled`）、超时（`RequestTimeoutError`）、后端掉线（`onBackendLost` 广播）——`useChatSession` 已处理，别在组件里重复判断。
4. **数据来源**：模型/角色/会话/知识库来自后端；群组、设置偏好只在 localStorage；不要在 localStorage 复制后端数据。
5. **生成中 UI**：没有 SSE，`liveSteps` 靠 `getTrace` 轮询；轮询生命周期在 `useChatSession`。
6. **Tauri API 必须判环境**：仅 Tauri 可用的能力（窗口、opener、updater）不要在纯浏览器下无条件调用。
7. **UI 组件**：`components/ui/*` 是基础层，业务改动优先在 `views/` / `chat/`，不要为单个页面改基础组件。
8. **文案中文**；颜色用主题令牌（`brand-*`、`ink-*`、`surface`），不要硬编码新色值。
