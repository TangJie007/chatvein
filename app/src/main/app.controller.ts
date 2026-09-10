import { app } from 'electron'
import { Controller, IpcHandle, AppEvent,Inject  } from '@electrum/common'
import { AppService } from './app.service';

@Controller('app')
export class AppController {
  @Inject(AppService) 
  appService: AppService;
  @IpcHandle('ping')
  ping(message: string): { echo: string; at: number } {
    return { echo: message, at: Date.now() }
  }


  @AppEvent('ready')
  onReady(): void {
    // this.appService.onAppReady()
  }

  @AppEvent('window-all-closed')
  onAllClosed(): void {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  }

}
