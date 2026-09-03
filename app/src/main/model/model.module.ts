import { Module } from '@electrum/common'
import { ModelController } from './model.controller'
import { ModelService } from './model.service'
import { ModelStore } from './model.store'

@Module({
  controllers: [ModelController],
  providers: [ModelStore, ModelService],
  exports: [ModelService],
})
export class ModelModule {}
