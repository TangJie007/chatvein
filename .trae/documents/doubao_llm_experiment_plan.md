# 豆包 LLM 实验页实现计划

## 仓库调研结论

### 现有架构
- **框架**: 自研 `@electrum/*` MVC 框架（NestJS 风格），包含 common/core/client/preload/testing 五个包
- **主进程**: Electron + TypeScript，使用 `@Injectable`、`@Controller`、`@IpcHandle` 装饰器
- **渲染进程**: Vue 3 + Element Plus，通过 `@electrum/client` 与 preload 暴露的 API 通信
- **模块组织**: 每个业务功能 = `XxxModule` + `XxxController` + `XxxService`，放在 `app/src/main/xxx/` 下
- **IPC 通道**: `@IpcHandle('channel')` 映射 `prefix:channel`，渲染侧通过 `api.prefix:channel()` 调用

### 关键约束
1. 主进程通过 `BrowserWindow.webContents.executeJavaScript()` 操作浏览器 DOM
2. 豆包网页版需要登录态（用户需手动登录）
3. DOM 选择器需自适应豆包可能变化的页面结构
4. 返回 XML 格式便于工具链解析

### 豆包网页 DOM 结构假设
- 输入框: `<textarea>` 或 `contenteditable` 元素，class 含输入相关标识
- 发送按钮: `<button>` 元素，带"发送"/"send"等标识
- 对话消息: 消息列表中区分 user/assistant 角色
- 需要等待响应完成（检测"正在输入"状态消失）

## 文件与模块

### 新增文件
1. **`app/src/main/doubao/doubao.service.ts`** — 核心服务：BrowserView 管理、DOM 读写、消息抽取
2. **`app/src/main/doubao/doubao.controller.ts`** — IPC 控制器：暴露 `doubao:*` 通道
3. **`app/src/main/doubao/doubao.module.ts`** — 模块注册
4. **`app/src/renderer/views/DoubaoView.vue`** — 实验页 UI

### 修改文件
5. **`app/src/main/app.module.ts`** — 注册 `DoubaoModule`
6. **`app/src/renderer/App.vue`** — 添加豆包导航项和路由
7. **`app/src/renderer/components/TitleBar.vue`** — 添加豆包菜单项
8. **`app/src/renderer/ipc-api.ts`** — 添加 `doubao:*` 类型定义
9. **`packages/common/src/decorators/controller.decorator.ts`** — 确认多窗口支持（如需 `window` 选项）

## 实现步骤

### Step 1: 创建 DoubaoService（主进程核心）
```
doubao.service.ts:
- 属性: BrowserView 实例、WebContents 引用、消息状态
- connect(): 创建 BrowserView 加载豆包网页
- sendPrompt(text): executeJavaScript 写入 textarea + 触发发送
- extractMessages(): executeJavaScript 读取 DOM，返回结构化消息数组
- toXml(messages): 将消息数组转为 XML 字符串
- isGenerating(): 检测是否正在生成（检测"正在输入"标识）
- waitForCompletion(): 轮询等待响应完成
```

**DOM 选择器策略**（需在运行时动态适配）:
```typescript
// 输入框选择器（多候选）
const inputSelectors = [
  'textarea[data-testid="reply-box"]',
  'textarea[placeholder*="发消息"]',
  'div[contenteditable="true"][data-testid="reply-box"]',
  '.chat-input textarea',
]

// 发送按钮选择器
const sendSelectors = [
  'button[data-testid="send"]',
  'button[aria-label*="发送"]',
  'button.send-btn',
]

// 消息容器选择器
const messageSelectors = [
  '.message-list .message-item',
  '[data-role="message"]',
  '.chat-message',
]
```

### Step 2: 创建 DoubaoController
```typescript
@Controller({ prefix: 'doubao', window: 'main' })
export class DoubaoController {
  @IpcHandle('connect')     // 连接到豆包
  @IpcHandle('send')        // 发送 prompt
  @IpcHandle('messages')    // 获取当前消息列表
  @IpcHandle('extract')     // 提取并返回 XML
  @IpcHandle('status')      // 连接状态
  @IpcEmit('message')       // 推送新消息
}
```

### Step 3: 创建 DoubaoModule
```typescript
@Module({
  controllers: [DoubaoController],
  providers: [DoubaoService],
})
export class DoubaoModule {}
```

### Step 4: 创建 DoubaoView.vue 渲染页
- 左侧：输入区（textarea + 发送按钮 + 加载状态）
- 右侧：XML 输出预览 + 复制按钮
- 底部：连接状态指示 + DOM 选择器调试面板
- 使用 `api.doubao:*` 调用 IPC

### Step 5: 注册模块和导航
- AppModule 导入 DoubaoModule
- App.vue 添加 `豆包实验` 导航项
- TitleBar 添加对应菜单
- ipc-api.ts 添加类型

## 依赖与注意事项

### DOM 解析策略
1. **不修改真实 DOM**：所有 DOM 操作通过 `executeJavaScript` 实现，只读或克隆后操作
2. **容错选择器**：每个元素提供多个候选选择器，依次尝试
3. **动态检测完成态**：轮询检测消息末尾是否仍在变化（新增内容/打字动画消失）
4. **结构化抽取**：每条消息提取 `{role, content, timestamp}`

### XML 输出格式
```xml
<?xml version="1.0" encoding="UTF-8"?>
<conversation>
  <message role="user" timestamp="1727300000">如何实现快速排序？</message>
  <message role="assistant" timestamp="1727300001">快速排序的核心思想是...</message>
</conversation>
```

### BrowserView 布局
- 豆包 BrowserView 嵌入主窗口，但需要预留控制区域
- 或使用独立窗口承载 BrowserView，主窗口做控制面板

### 安全与隔离
- BrowserView 需设置 `contextIsolation: true`
- preload 脚本中需暴露额外 API（如需要 DOM 操作从主进程发起）
- 豆包可能有 CSP 限制，需要 `webSecurity: false` 或 `allowRunningInsecureContent`

## 验证

1. `pnpm run build` 构建成功
2. `pnpm run dev:example` 启动后，导航到"豆包实验"页面
3. 点击"连接"按钮，BrowserView 加载豆包页面
4. 手动在 BrowserView 中登录豆包
5. 在控制面板输入 prompt，点击发送
6. 豆包响应后，XML 输出区显示结构化 XML
7. 多次对话验证上下文保持

## 风险与处理

| 风险 | 处理方案 |
|------|---------|
| 豆包 DOM 结构变化导致选择器失效 | 提供多候选选择器 + 运行时日志 + 调试面板显示命中元素 |
| BrowserView 加载需要时间 | 添加加载状态检测 + 超时处理 |
| 豆包可能阻止 executeJavaScript | 使用 `webContents.debugger` 或 `webContents.executeJavaScriptInIsolatedWorld` |
| 登录态不稳定 | 提示用户手动登录，保存 session |
| 响应生成时间不确定 | 智能等待：检测内容停止变化 + 最大超时兜底 |
| contextIsolation 限制 | BrowserView 的 webPreferences 需配置允许主进程执行 JS |
