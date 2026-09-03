import { Controller, IpcHandle, Inject } from '@electrum/common'
import { AgentService, type AgentInput } from './agent.service'
import type { AgentConfig } from './agent.types'

@Controller('agent')
export class AgentController {
  @Inject(AgentService)
  agents!: AgentService

  @IpcHandle('list')
  list(): Promise<AgentConfig[]> {
    return this.agents.list()
  }

  @IpcHandle('get')
  get(id: string): Promise<AgentConfig> {
    return this.agents.get(id)
  }

  @IpcHandle('create')
  create(input?: AgentInput): Promise<AgentConfig> {
    return this.agents.create(input ?? {})
  }

  @IpcHandle('update')
  update(data: { id: string; patch: AgentInput }): Promise<AgentConfig> {
    return this.agents.update(data.id, data.patch)
  }

  @IpcHandle('remove')
  remove(id: string): Promise<{ ok: true }> {
    return this.agents.remove(id)
  }
}
