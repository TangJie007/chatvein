# 发布检查清单（Go-Live Checklist）

在把 ChatVein 交付给真实用户前，逐项确认以下内容。其中「已内建」的部分随代码发布即生效；
「需人工配置」的部分必须由发布者准备证书 / 密钥 / 账号，无法代码化。

## 一、已内建（本分支修复）

| 项 | 说明 |
|---|---|
| 进程治理 | Python 后端挂在 Windows Job Object（`KILL_ON_JOB_CLOSE`），父进程强杀/崩溃时 OS 自动收割进程树；`RunEvent::Exit` 兜底 kill；单实例插件防双开 |
| 崩溃自愈 | 监督线程 `try_wait` 轮询，异常退出自动重启（最多 3 次），重启成功后重新广播 `backend-ready`，前端自动恢复 |
| 健康检查 | 就绪判定由「TCP 连通」升级为「HTTP `GET /api/health` 返回 200 + status=ok」 |
| 日志 | `tauri-plugin-log` 落盘（`app_log_dir/chatvein.log`，随进程轮转）+ 终端；后端 stderr 同时落盘与上抛；panic hook 写 `crash.log` |
| 凭据加密 | `llm_models.api_key` 以 Fernet 密文落库（密钥在 `CHATVEIN_DATA_DIR/secret.key`，0600）；Agent 的 `sqlite_query` 屏蔽 `llm_models`/`api_key` 等敏感对象；数据浏览页对凭据列脱敏 |
| SSRF 防护 | `web_fetch` 拒绝内网/回环/链路本地/云元数据地址；httpx 逐跳重定向校验 |
| 注入缓解 | 网页正文、搜索结果、第三方 SKILL.md 以 `<untrusted>` 定界符隔离并声明「非指令」 |
| 前端韧性 | 顶层 ErrorBoundary 防白屏；请求默认 30s 超时；GET 自动重试 1 次；后端掉线自动重连 |
| CI | `.github/workflows/ci.yml`：tsc + vitest + pytest + Windows 全量构建 |

## 二、发布前必须人工完成

### 1. 元信息
- [ ] `src-tauri/Cargo.toml`：作者从 `"you"` 改为真实主体；`version` 从 `0.1.0` 升到正式版本（与 `package.json` 同步）。
- [ ] 仓库根添加 `LICENSE`（当前缺失）。
- [ ] 编写并内置隐私政策 / 用户协议（说明数据仅存本机、第三方技能与联网工具的出口行为）。

### 2. 代码签名与公证（缺一不可）
- **Windows Authenticode 签名**：购买/使用代码签名证书（EV/OV），用 `signtool.exe` 或 CI 的 `azure/sign-action` 签名：
  - `backend.exe` 与 `ChatVein.exe` 都要签；建议同时签 `_internal` 里的关键 dll（至少 exe）。
  - 不签名的后果：SmartScreen「未知发布者」红色拦截。
- **macOS 公证（Notarization）**：需 Apple Developer 账号 + Developer ID 证书，`codesign --deep --force --options runtime` 后 `notarytool submit` 公证并 stapler。否则 Gatekeeper 报「已损坏，无法打开」。

### 3. 自动更新（Updater）— 已走 COS 模式
Tauri v2 updater 是「静态 HTTP 端点」模型，更新走腾讯云 COS 对象存储。当前骨架已代码化：
- `src-tauri/tauri.conf.json` → `plugins.updater`：已内嵌公钥（`C:\Users\Administrator\.tauri\chatvein.key.pub`）与真实 COS endpoint `https://lingjin-app-1254228834.cos.ap-guangzhou.myqcloud.com/chatvein/updater/latest.json`。
- Rust 已注册 `tauri-plugin-updater` + `tauri-plugin-process`；前端设置页「软件更新」卡片 + 启动时按 `autoUpdate` 偏好自动检查（发现新版系统弹窗询问，不静默安装）。endpoint 无效时前端静默跳过 / 设置页提示（历史教训：曾用 `<bucket>/<region>` 占位符导致插件启动 panic）。
- 发版脚本 `tools/release_updater.ps1`：build → sign → 生成 `latest.json` + `.sig` → 提示上传。

**密钥对**（已生成一次，私钥勿外传）：
```powershell
# 私钥：C:\Users\Administrator\.tauri\chatvein.key（生产发布前建议重新生成并妥善保管）
# 公钥：C:\Users\Administrator\.tauri\chatvein.key.pub（已内嵌进 tauri.conf.json）
```

**每次发版流程**（真实 endpoint 已内置在 `tauri.conf.json`，直接构建即可）：
```powershell
npm run tauri build
.\tools\release_updater.ps1 -Version 0.1.1 -Notes "本次更新说明"
# 把 dist-updater/ 下文件上传到 COS 桶 chatvein/updater/（公有读或 CDN 可读）
# 上传后在 COS 控制台 / CDN 刷新 latest.json 缓存
```
> 如需临时指向其他环境（如测试桶），可用 `tauri build --config` 覆盖 endpoints：`npm run tauri build -- --config "{`"plugins`":{`"updater`":{`"endpoints`":[`"https://...`"]}}}"`。

**COS 桶结构**：
```
chatvein/updater/
  latest.json                      ← 更新清单（含版本/签名/URL）
  ChatVein_0.1.1_x64-setup.exe     ← NSIS 安装包（updater 仅支持 NSIS，不支持 MSI）
```

**注意点**：
- 安装包必须是 **NSIS（.exe）**，updater 不支持 MSI；`bundle.targets` 为 `"all"` 会同时出 nsis，确认 `target/release/bundle/nsis/` 存在。
- COS 桶建议**私有写 + 公有读**（只放更新产物）；签名校验保证包完整性，篡改会被拒绝。
- **中国大陆访问 COS 自带域名需 ICP 备案**；未备案就接 CDN（回源 COS）或改用海外 region 桶。
- 每次发布后必须刷新 CDN 缓存，否则客户端拿到旧清单。
- 没有更新通道时，线上问题只能靠用户手动重装——务必在首批内测前完成。

### 4. 跨平台产物
- 当前 `tools/build_backend.ps1` 仅面向 Windows。macOS / Linux 需：
  - `backend/backend.spec` 对应产物名与路径的适配；
  - Tauri `bundle.targets` 与签名/公证流程；
  - Linux 的 `AppImage`/`deb` + `libwebkit2gtk` 依赖说明。
- 若暂无跨平台计划，至少在 README 声明「当前仅支持 Windows x64」。

### 5. 初始化体验
- [ ] embedding 权重首次下载（`CHATVEIN_DATA_DIR/embeddings`）增加进度提示与失败可重试（当前为静默按需下载）。
- [ ] 首次运行引导页：配置模型、导入密钥、选择工作区。

### 6. 发布前回归
- [ ] 本地 `npm run tauri build` 全绿（CI 已覆盖 tsc/vitest/pytest）。
- [ ] 干净机器（无 Python、无 .venv）安装包可运行，后端随包自动启动。
- [ ] 强杀进程（任务管理器结束 `ChatVein.exe`）后重启：无残留 `backend.exe`，端口可复用。
- [ ] 双开应用：第二实例聚焦首窗口，不重复启后端。
- [ ] 模拟后端崩溃（任务管理器结束 `backend.exe`）：3 秒内自动重启，界面提示后自动恢复，聊天上下文不丢。

## 三、建议后续（非阻塞）
- 敏感操作工具（bash/浏览器/文件写）二次确认与操作审计记录。
- `web_fetch` 进一步加主机白名单/去广告域过滤。
- 自动上报崩溃现场（Sentry / 自建），配合日志轮转落地。
