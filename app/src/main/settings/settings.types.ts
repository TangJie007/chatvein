export interface AppSettings {
  version: 1
  /**
   * 工作区根目录：会话目录落在 `{workspaceRoot}/{slug}/`，
   * 运行沙箱在 `{workspaceRoot}/{slug}/runs/`。
   * 空字符串 = 使用系统建议默认（文档/Chatvein/workspaces）。
   */
  workspaceRoot: string
  /**
   * 编程开发模式的项目根目录：开启「编程开发」档时，文件读写 / 脚本执行等
   * 工具的 jail 根从会话私有沙箱切换为该项目目录，从而能在真实仓库内改代码。
   * 空字符串 = 未设置（回落到会话沙箱）。
   */
  devProjectRoot: string
  cmdAllowlist: boolean
  confirmWrites: boolean
  reduceMotion: boolean
}

export interface AppSettingsView extends AppSettings {
  /** 解析后的有效路径（空配置时回落到默认） */
  effectiveWorkspaceRoot: string
  defaultWorkspaceRoot: string
}

export type AppSettingsPatch = Partial<
  Pick<
    AppSettings,
    'workspaceRoot' | 'devProjectRoot' | 'cmdAllowlist' | 'confirmWrites' | 'reduceMotion'
  >
>
