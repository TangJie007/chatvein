import { Module } from '@electrum/common'
import { AgentModule } from '../agent/agent.module'
import { ModelModule } from '../model/model.module'
import { SettingsModule } from '../settings/settings.module'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { ChatStore } from './session/chat.store'
import { ShortTermMemory } from './memory/short-term'
import { ToolIndexService } from './tools/tool-index.service'
import { ChatLlmHelper } from './turn/llm'

@Module({
  imports: [AgentModule, ModelModule, SettingsModule],
  controllers: [ChatController],
  providers: [ChatStore, ChatLlmHelper, ToolIndexService, ShortTermMemory, ChatService],
  exports: [ChatService],
})
export class ChatModule {}
