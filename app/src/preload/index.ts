import { exposeApi } from '@electrum/preload'
import { contextBridge, webUtils } from 'electron'

exposeApi()

// 拖放文件时取真实本地路径：Electron contextIsolation 下渲染进程无法直接读 File.path，
// webUtils.getPathForFile 必须由 preload 调用，再把字符串回传。
contextBridge.exposeInMainWorld('fileApi', {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
})
