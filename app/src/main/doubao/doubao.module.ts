import { Module } from '@electrum/common'
import { DoubaoController } from './doubao.controller'
import { DoubaoService } from './doubao.service'

@Module({
  controllers: [DoubaoController],
  providers: [DoubaoService],
})
export class DoubaoModule {}
