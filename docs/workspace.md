# 工作区模型（Workspace Model）

本应用存在**两层工作区**，二者容易混淆，特立此文档避免踩坑。

## 两层结构

- **主工作区（main workspace）**：用户在设置页配置的空间；通过 `PUT /api/workspace` 设置，
  或由环境变量 `CHATVEIN_WORKSPACE` 指定，否则落到 `CHATVEIN_DATA_DIR/workspace`。
  由 `backend/mcps/workspace.py` 的 `workspace_root()` 解析。

  主工作区是**配置项 / 容器**，不是 Agent 实际读写文件的沙箱。

- **会话工作区（conversation workspace）**：在主工作区之下，为每个会话分配的
  `YYYYMMDD-HHMMSS-xxxxx` 目录（`backend/mcps/sandbox.py: allocate_workspace_name`）。
  由 `conversation_root()` + `init_conversation_layout()` 解析成带 `output/ logs/ runs/`
  布局的目录。**这才是 Agent 真正运行、读写文件的「真正工作区」。**

路径关系：

```text
<主工作区>                                  (workspace_root)
  └─ <YYYYMMDD-HHMMSS-xxxxx>/               (会话工作区 = current_sandbox，真正的沙箱)
       output/                              # 产物：用户需要的文件
       logs/
         session.sqlite                     # 本会话：消息(短期记忆) / 工具返回 / meta
       runs/
         .venv/                             # 代码沙箱虚拟环境
         *.py                               # 沙箱脚本
       uploads/                             # 输入框拖入/选择的本机文件落盘处
       ocr_input/                           # OCR 把图片落到的位置
```

## 关键规则（务必遵守，避免出错）

1. **Agent 在会话沙箱内运行**。`POST /api/chat` 以
   `use_conversation_sandbox(workspace_dir)` 包裹整轮，之后 `current_sandbox()` 与
   `resolve_in_sandbox()` 都相对**会话目录**，而非主工作区。文件系统工具（`mcp-fs` 的
   `write_file` / `list_directory` 等）与 bash / 代码沙箱一样，只认会话根。
   路径入参：会话内可用相对或绝对路径；**会话外必须传绝对路径**，并走与 Bash
   相同的人机确认弹窗，允许后才执行。

2. **任何需要被 Agent 读取的文件，必须落在所属会话工作区内，不要落在主工作区根目录。**
   - 例：`ocr_image(source)` 解析本地路径时，先 `resolve_in_sandbox`（会话目录），
     失败才 `resolve_in_workspace`（主工作区）兜底。若文件只在主工作区根，会多一次拷贝，
     且新会话的沙箱根本找不到它 —— 这正是「找不到图片」类报错的来源。

3. **上传接口 `POST /api/uploads` 必须带 `conversation_id`。**
   后端 `_resolve_upload_root()` 据此把文件写入对应会话工作区的 `uploads/`，并返回
   **相对会话根**的路径（如 `uploads/微信图片_xxxx_ab12cd.jpg`）。
   缺 `conversation_id` 时回退到主工作区（兜底），但不符合预期，形同 bug。

4. **前端已逐级透传当前会话 id**：`ChatView(activeId) → ChatPanel(conversationId) →
   Composer`，`uploadFiles(files, conversationId)` 会把它发到后端。改动上传链路时
   不要丢失这层传递；新增「拖拽/选择文件」入口也要带上 `conversationId`。

## 代码落点

| 文件 | 关键符号 | 职责 |
| --- | --- | --- |
| `backend/mcps/workspace.py` | `workspace_root()` `resolve_in_workspace()` | 主工作区解析与越界校验 |
| `backend/mcps/tools/fs.py` | `_resolve` → `current_sandbox` / `resolve_in_sandbox` | Agent 文件工具只认会话根 |
| `backend/conversations/service.py` | `workspace_root_for(workspace_dir)` | 把会话 `workspace_dir` 解析成带布局的会话根 |
| `backend/main.py` | `/api/uploads` → `_resolve_upload_root()` `_handle_upload_item()` | 上传落盘到会话工作区（或回退主工作区） |
| `src/api.ts` | `uploadFiles(files, conversationId?)` | 前端上传入口，透传会话 id |
| `src/components/views/ChatView.tsx` `src/components/chat/ChatPanel.tsx` `src/components/chat/Composer.tsx` | `conversationId` 透传 | 把当前会话 id 送到上传调用 |

## 一句话总结

> 配置的是**主工作区**；在主工作区里按日期生成的 `YYYYMMDD-HHMMSS-xxxxx` 会话文件夹，
> 才是 Agent 真正干活的**工作区**。凡是给 Agent 用的文件（上传图片、附件等），
> 都放进这个会话文件夹，而不要放进主工作区根。
