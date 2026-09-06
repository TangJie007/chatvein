# 决策笔记：删除确认用应用内 Dialog，不用 window.confirm

状态：已落地

## 背景

Chat 删除对话原先用渲染层 `window.confirm`。应用是 Electron **无边框**窗口（`frame: false`），Windows 上原生确认框会抢 OS 焦点，关闭后 `webContents` 焦点偶发回不来，表现为「删对话 → 新建 → 点输入框没反应」。Composer 本身也没有程序化 focus，放大了该问题。

## 决策

对话删除确认改为渲染层组件 `ConfirmDialog`（`@headlessui/vue` 的 `Dialog`，与既有 `SourceDrawer` 同栈）：

- 入口：`app/src/renderer/views/ChatView.vue` 打开确认态，确认后再 `chat.remove`
- 组件：`app/src/renderer/components/ui/ConfirmDialog.vue`
- 危险确认按钮走 `AppButton` 的 `danger` variant
- 删除中确认按钮显示 spinner +「正在删除…」；成功后再关弹窗
- **10s 超时兜底**：`Promise.race` 超时后立刻关弹窗并清 busy，后台 `remove` 继续，结果只写状态栏，不阻塞新建/切换等后续操作

焦点与键盘陷阱留在同一 `BrowserWindow` 内，不再经过系统模态框。

## 备选方案

**继续用 `window.confirm` + 事后 `webContents.focus()`**：仍依赖 OS 对话框行为，frameless 下回焦不稳定，治标不治本。

**主进程 `dialog.showMessageBox`**：可绑定到当前 `BrowserWindow`，比 `window.confirm` 可靠，但仍是原生模态；确认文案与样式无法跟 Forge UI 统一，且 IPC 往返多余。

## 影响

- 收益：删除确认不再抢走渲染焦点；UI 与设计 token 一致；可复用到其它危险操作。
- 代价 / 放弃：Agents / Models / Settings / ThinkingPanel 等处仍有 `window.confirm`，未一并迁移。
- 后续注意：同类危险操作优先复用 `ConfirmDialog`，避免再引入原生 confirm。
