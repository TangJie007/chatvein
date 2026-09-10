import type { SafetyRule } from '../types'

/**
 * 内置规则基线（**桌面端威胁模型**）。
 *
 * 场景：Electron 桌面单用户 agent，持有真实的文件系统权限。
 * 重心在「agent 在本地干蠢事」：破坏性操作 > 凭据外发 > 间接注入。
 *
 * 一个桌面端特有的判断：**只有注入是 `reject`，其余一律 `flag`**。
 * 用户是自己数据的所有者，有权删文件、也有权把内容传走 ——
 * 真正要防的是「用户不知情」，所以抬档让他确认，而不是替他拒绝。
 *
 * 拿不准的继续用 `flag`：误杀比漏拦更伤体验。
 */
export const DEFAULT_SAFETY_RULES: SafetyRule[] = [
  // —— 间接提示词注入：读恶意文件 / 网页内容触发 ——
  {
    id: 'inj.ignore-en',
    category: 'injection',
    action: 'reject',
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
    reason: '试图覆盖既有指令',
  },
  {
    id: 'inj.ignore-zh',
    category: 'injection',
    action: 'reject',
    pattern: /(忽略|无视|忘记)(以上|上面|之前|前面)?(的)?(所有)?(指令|规则|提示|设定)/,
    reason: '试图覆盖既有指令',
  },
  {
    id: 'inj.role',
    category: 'injection',
    action: 'reject',
    pattern: /(system\s*prompt)|你(现在|立刻|马上)(就)?是\s*(一个)?(新的|另一个|不同的)/i,
    reason: '试图注入系统角色',
  },

  // —— 本地破坏性操作：桌面端头号风险 ——
  {
    id: 'dest.destructive',
    category: 'destructive',
    action: 'flag',
    pattern:
      /(rm\s+-r?f?|del\s+\/[fqs]|drop\s+(table|database)|git\s+reset\s+--hard|force\s+push|格式化|清空|删除全部|删除文件|覆盖(写入|文件))/i,
    reason: '破坏性本地操作，需用户确认',
  },

  // —— 敏感路径 ——
  {
    id: 'priv.sensitive-path',
    category: 'privilege',
    action: 'flag',
    pattern: /(\.ssh|\.aws|\.gnupg|\/etc\/|System32|密钥链|钥匙串)/i,
    reason: '涉及敏感路径，需用户确认',
  },

  // —— 凭据 ——
  {
    id: 'priv.credentials',
    category: 'privilege',
    action: 'flag',
    pattern: /(\.env\b|secret[_-]?key|api[_-]?key|私钥|密钥|口令)/i,
    reason: '涉及凭据或密钥，需用户确认',
  },

  // —— 数据外发：用户有权外发自己的数据，但要让他知道 ——
  {
    id: 'exfil.upload',
    category: 'exfiltration',
    action: 'flag',
    pattern: /(发送|上传|post|upload|curl\s+-d)\s*(到|至)?\s*https?:\/\//i,
    reason: '将内容外发到外部地址，需用户确认',
  },
]
