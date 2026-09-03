export interface AppSettings {
  version: 1
  /**
   * 工作区根目录：用户项目 / 日常工作文件的默认落点。
   * 空字符串 = 使用系统建议默认（文档/Chatvein/workspaces）。
   */
  workspaceRoot: string
  /**
   * 沙箱运行根目录：runs/<run_id>/workspace 的父目录。
   * 空字符串 = 使用系统建议默认（文档/Chatvein/runs）。
   */
  runsRoot: string
  cmdAllowlist: boolean
  confirmWrites: boolean
  reduceMotion: boolean
}

export interface AppSettingsView extends AppSettings {
  /** 解析后的有效路径（空配置时回落到默认） */
  effectiveWorkspaceRoot: string
  effectiveRunsRoot: string
  defaultWorkspaceRoot: string
  defaultRunsRoot: string
}

export type AppSettingsPatch = Partial<
  Pick<AppSettings, 'workspaceRoot' | 'runsRoot' | 'cmdAllowlist' | 'confirmWrites' | 'reduceMotion'>
>
