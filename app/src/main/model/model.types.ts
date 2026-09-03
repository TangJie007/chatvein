// 主进程侧模型配置类型。渲染端契约见 src/renderer/ipc-api.ts（保持字段一致）。

/** 一期仅支持 OpenAI 兼容协议 */
export interface ModelConfig {
  id: string
  /** 展示名，如「DeepSeek Chat」 */
  name: string
  protocol: 'openai'
  /** 预置 provider 标识（deepseek/openai/qwen/...）或 'custom' */
  provider: string
  baseUrl: string
  /** 内存 / IPC 明文；落盘为加密字段 apiKeyEnc */
  apiKey: string
  /** 网关侧模型 id，如 deepseek-chat */
  model: string
  temperature: number
  maxTokens: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/** 磁盘落盘结构：apiKey 以密文存储 */
export interface ModelConfigDisk {
  id: string
  name: string
  protocol: 'openai'
  provider: string
  baseUrl: string
  /** enc:v1:… 密文；旧文件可能仍是明文 apiKey */
  apiKeyEnc?: string
  /** @deprecated 仅迁移旧明文 */
  apiKey?: string
  model: string
  temperature: number
  maxTokens: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface ModelStoreFile {
  version: 2
  models: ModelConfigDisk[]
}

export interface ProviderPreset {
  value: string
  label: string
  baseUrl: string
  models: string[]
}

/** OpenAI 兼容 provider 预设（一期：所有 provider 均走 OpenAI 兼容 /v1 接口） */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini', 'o3-mini'] },
  { value: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  { value: 'moonshot', label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
  { value: 'local', label: '本地 Relay', baseUrl: 'http://127.0.0.1:4444/v1', models: ['deepseek-chat', 'gpt-4o-mini'] },
  { value: 'custom', label: '自定义 · OpenAI 兼容', baseUrl: '', models: [] },
]

export interface ConnectionTestResult {
  ok: boolean
  latencyMs: number
  message: string
  model?: string
}
