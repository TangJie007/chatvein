import { Module } from '@electrum/common'
import { VectorController } from './vector.controller'
import { VectorService } from './vector.service'

@Module({
  controllers: [VectorController],
  providers: [VectorService],
})
export class VectorModule {}
