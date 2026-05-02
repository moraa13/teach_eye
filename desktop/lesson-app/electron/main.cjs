const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

function resolveAppFile(...segments) {
  return path.join(__dirname, '..', ...segments)
}

function createMainWindow() {
  const preloadPath = resolveAppFile('electron', 'preload.cjs')
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: '#0b1220',
    title: 'TeachEye Board',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const distIndex = resolveAppFile('dist', 'index.html')
  if (fs.existsSync(distIndex)) {
    window.loadFile(distIndex)
  } else {
    window.loadURL('http://127.0.0.1:5173')
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
