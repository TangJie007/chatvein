export interface AppSettings {
  version: 1
  /**
   * 工作区根目录：会话目录落在 `{workspaceRoot}/{slug}/`，
   * 运行沙箱在 `{workspaceRoot}/{slug}/runs/`。
   * 空字符串 = 使用系统建议默认（文档/Chatvein/workspaces）。
   */
  workspaceRoot: string
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
  Pick<AppSettings, 'workspaceRoot' | 'cmdAllowlist' | 'confirmWrites' | 'reduceMotion'>
>
