# @electrum/example-basic

Demonstrates `@electrum/common` + `@electrum/core` + `@electrum/preload` + `@electrum/client` with an Element Plus admin shell:

- Module / Controller / IPC handlers
- Field injection and lifecycle hooks
- Frameless window + custom title bar controls (minimize / maximize / close)
- Custom in-app menus + native `Menu` accelerators
- Multi-window (`window:openChild`)
- Global filters / interceptors
- Preload: `exposeApi()` from `@electrum/preload`
- Renderer: Vue 3 + Element Plus + `createClient()`

## Dev

```bash
pnpm dev   # electron-vite dev --watch
```

From repo root:

```bash
pnpm build
pnpm dev:example
```

- **Renderer**（`src/renderer`）：Vite HMR，改 Vue 即时更新。
- **Main / Preload**：`electron-vite dev --watch` 重建并**重启** Electron 进程。

## Layout

| 路径 | 内容 |
|------|------|
| `src/main/window/` | 无边框主窗、窗口控制、多窗口、原生菜单 |
| `src/main/user/`、`file/` | 业务 Controller |
| `src/preload/index.ts` | `exposeApi()` |
| `src/renderer/` | Element Plus 管理端（标题栏 / 侧栏 / 各页面） |
