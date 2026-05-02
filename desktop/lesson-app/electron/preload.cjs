const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('teachEyeDesktop', {
  platform: process.platform,
  runtime: 'electron',
})
