import { Module } from '@electrum/common'
import { AgentModule } from '../agent/agent.module'
import { ModelModule } from '../model/model.module'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { ChatStore } from './chat.store'

@Module({
  imports: [AgentModule, ModelModule],
  controllers: [ChatController],
  providers: [ChatStore, ChatService],
  exports: [ChatService],
})
export class ChatModule {}
