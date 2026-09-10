import { Module } from '@electrum/common'
import { FilesService } from './files.service'

/**
 * 文件域模块：集中对话附件（文件上传）相关的处理。
 * `FilesService` 注册为全局可见 Provider，供 ChatModule 等注入使用。
 */
@Module({
  providers: [FilesService],
})
export class FilesModule {}
