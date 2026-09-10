import { Controller, IpcHandle, Inject, NotFoundException } from '@electrum/common'

/**
 * 设置域 IPC 入口：统一承载「模型选型 / Agent 角色 / 应用设置」三块，
 * 因为它们本质上都是 settings 的一部分。
 * `settings:*`，仅做参数透传与异常包装，
 * 逻辑全部在 SettingsService。
 */
@Controller('settings')
export class SettingsController {

}
