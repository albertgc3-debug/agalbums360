const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const http = require('http')
const AdmZip = require('adm-zip')

let mainWindow
let playerWindow
let i18n = {}
let currentLanguage = 'ca'
let activeServer = null

const supportedLangs = ['ca', 'en', 'es']
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'))
  } catch (_) {
    return {}
  }
}

function saveSettings(nextSettings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(nextSettings, null, 2), 'utf-8')
}

function normalizeLanguage(lang = 'ca') {
  const normalized = String(lang).substring(0, 2).toLowerCase()
  return supportedLangs.includes(normalized) ? normalized : 'ca'
}

function loadLocale(lang = 'ca') {
  const langToUse = normalizeLanguage(lang)
  try {
    i18n = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${langToUse}.json`), 'utf-8'))
    currentLanguage = langToUse
  } catch (err) {
    console.error('Error loading locale:', err)
    i18n = { appTitle: 'AG Albums360' }
    currentLanguage = 'ca'
  }
  saveSettings({ ...loadSettings(), language: currentLanguage })
}

function getStartDirectory() {
  const settings = loadSettings()
  if (settings.lastDirectory && fs.existsSync(settings.lastDirectory)) return settings.lastDirectory
  const downloads = path.join(os.homedir(), 'Downloads')
  return fs.existsSync(downloads) ? downloads : os.homedir()
}

function setLastDirectory(targetPath) {
  const directory = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()
    ? targetPath
    : path.dirname(targetPath)
  saveSettings({ ...loadSettings(), lastDirectory: directory })
}

function emitToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function addLog(message) {
  emitToRenderer('log-message', { message, timestamp: Date.now() })
}

function emitProgress(percent, written, total) {
  emitToRenderer('progress-update', { percent, written, total })
}

function isVtourFile(filePath) {
  return /\.(vtour|zip)$/i.test(filePath)
}

function walkForFiles(rootDir, fileName, maxDepth) {
  const results = []
  function visit(currentDir, depth) {
    if (depth > maxDepth) return
    let entries = []
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch (_) {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) visit(fullPath, depth + 1)
      else if (entry.name.toLowerCase() === fileName.toLowerCase()) results.push(fullPath)
    }
  }
  visit(rootDir, 0)
  return results
}

function findBestIndexHtml(rootDir) {
  const panoFiles = walkForFiles(rootDir, 'pano.xml', 8)
  const indexFiles = walkForFiles(rootDir, 'index.html', 6)
  if (indexFiles.length === 0) return { indexPath: null, panoFiles }
  if (panoFiles.length > 0) {
    const panoDir = path.dirname(panoFiles[0])
    const sameDir = indexFiles.find((indexPath) => path.dirname(indexPath) === panoDir)
    if (sameDir) return { indexPath: sameDir, panoFiles }
  }
  return { indexPath: indexFiles[0], panoFiles }
}

function calculateZipTotalBytes(zipFile) {
  let total = 0
  const zip = new AdmZip(zipFile)
  for (const entry of zip.getEntries()) {
    if (!entry.isDirectory && entry.header && entry.header.size > 0) total += entry.header.size
  }
  return total
}

function extractZipWithProgress(zipFile, outDir) {
  const zip = new AdmZip(zipFile)
  const totalBytes = calculateZipTotalBytes(zipFile)
  let writtenBytes = 0
  let fileCount = 0
  let lastPercent = -1

  for (const entry of zip.getEntries()) {
    const destination = path.join(outDir, entry.entryName)
    if (entry.isDirectory) {
      fs.mkdirSync(destination, { recursive: true })
      continue
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    const data = entry.getData()
    fs.writeFileSync(destination, data)
    writtenBytes += data.length
    fileCount += 1
    const percent = totalBytes > 0 ? Math.round((writtenBytes * 100) / totalBytes) : 0
    if (percent !== lastPercent) {
      emitProgress(Math.max(0, Math.min(100, percent)), writtenBytes, totalBytes)
      lastPercent = percent
    }
  }

  emitProgress(100, writtenBytes, totalBytes)
  addLog(i18n.extractedFiles.replace('{count}', String(fileCount)))
}

function stopActiveServer() {
  if (!activeServer) return
  try { activeServer.close() } catch (_) {}
  activeServer = null
}

function createStaticServer(baseDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const requestPath = decodeURIComponent((req.url || '/').split('?')[0])
        const relativePath = requestPath === '/' ? '/index.html' : requestPath
        const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '')
        const filePath = path.join(baseDir, normalized.replace(/^[/\\]/, ''))
        if (!filePath.startsWith(baseDir)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' })
          res.end('Forbidden')
          return
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not Found')
          return
        }
        const ext = path.extname(filePath).toLowerCase()
        const mimeMap = {
          '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
          '.xml': 'application/xml', '.svg': 'image/svg+xml', '.gif': 'image/gif',
          '.webp': 'image/webp', '.json': 'application/json', '.png': 'image/png',
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4'
        }
        res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' })
        fs.createReadStream(filePath).pipe(res)
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(`Server error: ${error.message}`)
      }
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
    server.on('error', reject)
  })
}

function createOrFocusPlayerWindow() {
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.focus()
    return playerWindow
  }
  playerWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111111',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  playerWindow.on('closed', () => { playerWindow = null })
  return playerWindow
}

async function serveAndOpenIndex(indexPath) {
  const contentRoot = path.dirname(indexPath)
  addLog(i18n.servingFrom.replace('{path}', contentRoot))
  stopActiveServer()
  const server = await createStaticServer(contentRoot)
  activeServer = server
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const targetUrl = `http://127.0.0.1:${port}/${path.basename(indexPath)}`
  addLog(i18n.urlLabel.replace('{url}', targetUrl))
  const player = createOrFocusPlayerWindow()
  await player.loadURL(targetUrl)
  addLog(i18n.browserOpened)
}

async function openPreparedTour(rootDir) {
  const { indexPath, panoFiles } = findBestIndexHtml(rootDir)
  if (!indexPath) return { success: false, error: 'index.html not found' }
  addLog(i18n.indexFound.replace('{path}', indexPath))
  if (panoFiles.length > 0) addLog(i18n.panoFound.replace('{path}', panoFiles[0]))
  else addLog(i18n.panoNotFound)
  await serveAndOpenIndex(indexPath)
  return { success: true }
}

async function openVtourFromPath(vtourPath) {
  try {
    setLastDirectory(vtourPath)
    addLog(`\n${i18n.launchStarted}`)
    addLog(i18n.processing.replace('{name}', path.basename(vtourPath)))
    emitProgress(0, 0, 0)
    const tmpBase = path.join(os.tmpdir(), 'agalbums360-desktop')
    fs.mkdirSync(tmpBase, { recursive: true })
    const extractDir = path.join(tmpBase, `${path.basename(vtourPath, path.extname(vtourPath))}-${Date.now()}`)
    fs.mkdirSync(extractDir, { recursive: true })
    extractZipWithProgress(vtourPath, extractDir)
    return await openPreparedTour(extractDir)
  } catch (err) {
    addLog(i18n.errorMessage.replace('{message}', err.message || String(err)))
    return { success: false, error: String(err) }
  }
}

function getRendererState() {
  return {
    locale: i18n,
    language: currentLanguage,
    currentPath: getStartDirectory(),
    languageOptions: [
      { code: 'ca', label: 'CAT' },
      { code: 'en', label: 'ENG' },
      { code: 'es', label: 'ES' }
    ]
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 780,
    minHeight: 560,
    backgroundColor: '#ece7df',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'))
}

app.whenReady().then(async () => {
  const settings = loadSettings()
  loadLocale(settings.language || 'ca')
  createWindow()
  const args = process.argv.slice(1)
  for (const arg of args) {
    if (typeof arg === 'string' && isVtourFile(arg)) {
      await openVtourFromPath(arg)
      break
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopActiveServer()
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('get-app-state', () => getRendererState())
ipcMain.handle('set-language', async (_event, language) => {
  loadLocale(language)
  return getRendererState()
})
ipcMain.handle('pick-vtour-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    defaultPath: getStartDirectory(),
    filters: [{ name: 'VTour', extensions: ['vtour', 'zip'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  setLastDirectory(filePath)
  return filePath
})
ipcMain.handle('open-vtour', async (_event, vtourPath) => openVtourFromPath(vtourPath))
