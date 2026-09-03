import { Module } from '@electrum/common'
import { AgentController } from './agent.controller'
import { AgentService } from './agent.service'
import { AgentStore } from './agent.store'

@Module({
  controllers: [AgentController],
  providers: [AgentStore, AgentService],
  exports: [AgentStore, AgentService],
})
export class AgentModule {}
