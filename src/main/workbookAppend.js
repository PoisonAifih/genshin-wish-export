const ExcelJS = require('./module/exceljs.min.js')
const { ipcMain, dialog, shell } = require('electron')
const fs = require('fs-extra')
const path = require('path')
const config = require('./config')
const { getData } = require('./getData')
const { sendMsg, userDataPath } = require('./utils')
const i18n = require('./i18n')
const { SHEET_LAYOUTS, buildAppendRows, columnLetter } = require('./googleSheetsFormat')
const { createResolver } = require('./bannerSchedule')

const BACKUP_DIR = path.join(userDataPath, 'workbook-backups')

const text = () => i18n.workbook

const normalizeTitle = (title) => String(title == null ? '' : title).trim().toLowerCase()

/* Formula cells hold { formula, result }, rich text holds { richText: [...] };
   the anchor matcher only cares about what the cell displays. */
const plainValue = (value) => {
  if (value == null) return ''
  if (typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()
  if ('result' in value) return value.result == null ? '' : value.result
  if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('')
  if ('text' in value) return value.text
  return ''
}

const readRows = (ws, width) => {
  const rows = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const values = []
    for (let c = 1; c <= width; c++) values.push(plainValue(row.getCell(c).value))
    rows.push(values)
  }
  return rows
}

const timestamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15)

/* Excel keeps "~$<name>" next to a workbook while it is open. Writing underneath it
   would be silently undone the next time the user presses Ctrl+S in Excel. */
const assertNotOpen = (filePath) => {
  const lockFile = path.join(path.dirname(filePath), `~$${path.basename(filePath)}`)
  if (fs.existsSync(lockFile)) throw new Error(text().fileOpen)
}

const writeRows = (ws, layout, startRow, rows) => {
  const styleRow = startRow > 2 ? ws.getRow(startRow - 1) : null
  /* Columns that are a running count in the template stay formulas, so editing an
     earlier row still ripples down the way it did before. */
  const counters = layout.pity4 ? [0, 1, 2] : [0, 1]

  rows.forEach((values, offset) => {
    const r = startRow + offset
    const row = ws.getRow(r)
    values.forEach((value, i) => {
      const cell = row.getCell(i + 1)
      const col = columnLetter(i + 1)
      if (counters.includes(i) && r > 2 && value !== 1) {
        cell.value = { formula: `${col}${r - 1}+1`, result: value }
      } else {
        cell.value = value
      }
      if (styleRow) {
        const style = styleRow.getCell(i + 1).style
        if (style) cell.style = JSON.parse(JSON.stringify(style))
      }
    })
    row.commit()
  })
}

const start = async () => {
  const filePath = config.workbookPath
  if (!filePath) throw new Error(text().noFile)
  if (!fs.existsSync(filePath)) throw new Error(i18n.parse(text().missingFile, { path: filePath }))
  assertNotOpen(filePath)

  const { dataMap, current } = getData()
  const data = dataMap.get(current)
  if (!data) throw new Error(text().noData)

  const original = await fs.readFile(filePath)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(original)
  const sheets = new Map(workbook.worksheets.map(ws => [normalizeTitle(ws.name), ws]))

  let resolveBanner = () => ''
  try {
    sendMsg(text().schedule)
    resolveBanner = await createResolver({ uid: data.uid, lang: data.lang })
  } catch (e) {
    /* Losing the schedule only costs the Banner column; the rest of the export is still valid. */
    sendMsg(i18n.parse(text().scheduleFailed, { message: e.message }), 'ERROR')
  }

  /* Plan every tab before touching any, so an anchor failure on the last tab
     cannot leave the workbook half-updated. */
  const plans = []
  const summary = []
  for (const layout of SHEET_LAYOUTS) {
    const ws = sheets.get(normalizeTitle(layout.title))
    if (!ws) {
      summary.push({ title: layout.title.trim(), added: 0, skipped: true })
      continue
    }
    const records = data.result.get(layout.gachaType) || []
    const result = buildAppendRows(layout, readRows(ws, layout.width), records, resolveBanner)
    if (result.error) {
      const signature = result.detail.signature
      throw new Error(i18n.parse(text().errorAnchor, {
        sheet: ws.name.trim(),
        depth: String(signature.length),
        items: signature.map(item => item.name).join(', ')
      }))
    }
    plans.push({ ws, layout, result })
    summary.push({ title: ws.name.trim(), added: result.rows.length })
  }

  if (!plans.length) throw new Error(text().noTabs)

  const added = plans.reduce((sum, plan) => sum + plan.result.rows.length, 0)
  if (!added) return { added, summary, backup: '' }

  for (const { ws, layout, result } of plans) {
    const header = ws.getRow(1)
    const timeHeader = layout.header[layout.timeIndex]
    const timeCell = header.getCell(layout.timeIndex + 1)
    if (String(plainValue(timeCell.value)).trim() !== timeHeader) {
      timeCell.value = timeHeader
      timeCell.style = JSON.parse(JSON.stringify(header.getCell(1).style || {}))
    }
    if (result.rows.length) {
      sendMsg(i18n.parse(text().writing, { sheet: ws.name.trim(), count: String(result.rows.length) }))
      writeRows(ws, layout, result.existingCount + 2, result.rows)
    }
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

  const parsed = path.parse(filePath)
  const backup = path.join(BACKUP_DIR, `${parsed.name}_${timestamp()}${parsed.ext}`)
  await fs.outputFile(backup, original)

  assertNotOpen(filePath)
  try {
    await fs.writeFile(filePath, buffer)
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') throw new Error(text().fileOpen)
    throw e
  }

  return { added, summary, backup }
}

ipcMain.handle('WORKBOOK_STATUS', () => ({ path: config.workbookPath || '' }))

ipcMain.handle('WORKBOOK_PICK', async () => {
  const result = await dialog.showOpenDialog({
    defaultPath: config.workbookPath || undefined,
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (result.canceled || !result.filePaths.length) return config.workbookPath || ''
  config.workbookPath = result.filePaths[0]
  await config.save()
  return config.workbookPath
})

ipcMain.handle('WORKBOOK_APPEND', async () => await start())

ipcMain.handle('WORKBOOK_SHOW_BACKUPS', async () => {
  await fs.ensureDir(BACKUP_DIR)
  await shell.openPath(BACKUP_DIR)
})

exports.appendToWorkbook = start
