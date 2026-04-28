const brandStripTitle = document.getElementById('brand-strip-title')
const languageSelect = document.getElementById('language-select')
const languageLabel = document.getElementById('language-label')
const searchSectionTitle = document.getElementById('search-section-title')
const pickOpenButton = document.getElementById('pick-open-button')
const pickerHint = document.getElementById('picker-hint')
const selectedTourText = document.getElementById('selected-tour-text')
const openSectionTitle = document.getElementById('open-section-title')
const openButton = document.getElementById('open-button')
const progressText = document.getElementById('progress-text')
const progressFill = document.getElementById('progress-fill')
const logsTitle = document.getElementById('logs-title')
const toggleLogsButton = document.getElementById('toggle-logs-button')
const logContainer = document.getElementById('log-container')
const logText = document.getElementById('log-text')

let locale = {}
let currentLanguage = 'ca'
let selectedTourPath = null
let logsVisible = true
let removeLogListener = null
let removeProgressListener = null

function formatText(template, replacements = {}) {
  return Object.entries(replacements).reduce((text, [key, value]) => {
    return text.replaceAll(`{${key}}`, String(value))
  }, template || '')
}

function appendLog(message) {
  const trimmed = (message || '').trim()
  if (!trimmed) return

  if (logText.textContent === locale.logsPlaceholder) {
    logText.textContent = trimmed
  } else {
    logText.textContent += `\n${trimmed}`
  }

  logContainer.scrollTop = logContainer.scrollHeight
}

function setProgress(percent, written = 0, total = 0) {
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
  progressFill.style.width = `${safePercent}%`

  if (total > 0) {
    progressText.textContent = formatText(locale.progressLabelBytes, { percent: safePercent, written, total })
  } else {
    progressText.textContent = formatText(locale.progressLabel, { percent: safePercent })
  }
}

function updateSelectionLabel() {
  selectedTourText.textContent = formatText(locale.selectedTourLabel, {
    value: selectedTourPath || locale.noneLabel
  })
}

function applyLocaleTexts() {
  document.documentElement.lang = currentLanguage
  document.title = locale.appTitle
  brandStripTitle.textContent = locale.appTitle
  languageLabel.textContent = locale.languageLabel
  searchSectionTitle.textContent = locale.searchSectionTitle
  pickOpenButton.textContent = locale.pickOpenButton
  pickerHint.textContent = locale.pickerHint
  openSectionTitle.textContent = locale.openSectionTitle
  openButton.textContent = locale.openButton
  logsTitle.textContent = locale.logsTitle
  toggleLogsButton.textContent = logsVisible ? locale.logsToggleHide : locale.logsToggleShow

  if (!logText.textContent.trim()) logText.textContent = locale.logsPlaceholder

  updateSelectionLabel()
  setProgress(0, 0, 0)
}

function populateLanguageSelector(options) {
  languageSelect.replaceChildren(...options.map((option) => {
    const el = document.createElement('option')
    el.value = option.code
    el.textContent = option.label
    return el
  }))
  languageSelect.value = currentLanguage
}

async function bootstrap() {
  const state = await window.api.getAppState()
  locale = state.locale
  currentLanguage = state.language
  populateLanguageSelector(state.languageOptions)
  applyLocaleTexts()

  removeLogListener = window.api.onLogMessage(({ message }) => appendLog(message))
  removeProgressListener = window.api.onProgressUpdate(({ percent, written, total }) => setProgress(percent, written, total))
  appendLog(locale.viewerReady)
}

languageSelect.addEventListener('change', async () => {
  const state = await window.api.setLanguage(languageSelect.value)
  locale = state.locale
  currentLanguage = state.language
  populateLanguageSelector(state.languageOptions)
  applyLocaleTexts()
})

pickOpenButton.addEventListener('click', async () => {
  const pickedPath = await window.api.pickVtourFile()
  if (!pickedPath) return
  selectedTourPath = pickedPath
  updateSelectionLabel()
  appendLog(formatText(locale.tourSelected, { value: pickedPath }))
})

openButton.addEventListener('click', async () => {
  if (!selectedTourPath) {
    appendLog(locale.errorNoSelection)
    return
  }
  const result = await window.api.openVtour(selectedTourPath)
  if (!result.success && result.error) appendLog(`${locale.errorPrefix}${result.error}`)
})

toggleLogsButton.addEventListener('click', () => {
  logsVisible = !logsVisible
  logContainer.classList.toggle('collapsed', !logsVisible)
  toggleLogsButton.textContent = logsVisible ? locale.logsToggleHide : locale.logsToggleShow
})

window.addEventListener('beforeunload', () => {
  if (removeLogListener) removeLogListener()
  if (removeProgressListener) removeProgressListener()
})

bootstrap()
