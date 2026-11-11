const http = require('http')
const crypto = require('crypto')
const { ipcMain, shell } = require('electron')
const fetch = require('electron-fetch').default
const config = require('./config')
const { getData } = require('./getData')
const { cipherAes, decipherAes, sendMsg, getWin } = require('./utils')
const i18n = require('./i18n')
const { SHEET_LAYOUTS, buildAppendRows, quoteTitle, columnLetter } = require('./googleSheetsFormat')
const { createResolver } = require('./bannerSchedule')

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const AUTH_TIMEOUT = 5 * 60 * 1000

const text = () => i18n.googleSheets

const readSecret = (key) => {
  const value = config[key]
  if (!value) return ''
  try {
    return decipherAes(value)
  } catch (e) {
    return ''
  }
}

const writeSecret = (key, value) => {
  config[key] = value ? cipherAes(value) : ''
}

const base64url = (buffer) => buffer.toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '')

const closingPage = (message) => `<!doctype html><html><head><meta charset="utf-8"><title>${message}</title></head>` +
  `<body style="font-family:sans-serif;text-align:center;padding-top:80px"><h2>${message}</h2>` +
  `<p>${text().closeTab}</p></body></html>`

const waitForCode = (server, expectedState) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    server.close()
    reject(new Error(text().authTimeout))
  }, AUTH_TIMEOUT)

  const finish = (fn, arg) => {
    clearTimeout(timer)
    server.close()
    fn(arg)
  }

  server.on('request', (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    const state = url.searchParams.get('state')

    if (!code && !error) {
      res.writeHead(404).end()
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(closingPage(code && state === expectedState ? text().authSuccess : text().authFailed))

    const win = getWin()
    if (win) win.focus()

    if (error) return finish(reject, new Error(error))
    if (state !== expectedState) return finish(reject, new Error(text().authStateMismatch))
    finish(resolve, code)
  })
})

const tokenRequest = async (params) => {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    timeout: 20 * 1000
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(json.error_description || json.error || text().tokenFailed)
  }
  return json
}

const authorize = async () => {
  const clientId = config.googleClientId
  const clientSecret = readSecret('googleClientSecret')
  if (!clientId || !clientSecret) throw new Error(text().missingCredentials)

  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  const state = base64url(crypto.randomBytes(16))

  const server = http.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const redirectUri = `http://127.0.0.1:${server.address().port}`
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  })

  const codePromise = waitForCode(server, state)
  await shell.openExternal(`${AUTH_ENDPOINT}?${query.toString()}`)
  const code = await codePromise

  const token = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  })

  if (!token.refresh_token) throw new Error(text().noRefreshToken)
  writeSecret('googleRefreshToken', token.refresh_token)
  await config.save()
}

let accessToken = { value: '', expiresAt: 0 }

const getAccessToken = async () => {
  if (accessToken.value && Date.now() < accessToken.expiresAt) return accessToken.value

  const refreshToken = readSecret('googleRefreshToken')
  if (!refreshToken) throw new Error(text().notConnected)

  const token = await tokenRequest({
    client_id: config.googleClientId,
    client_secret: readSecret('googleClientSecret'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  })

  accessToken = {
    value: token.access_token,
    expiresAt: Date.now() + ((token.expires_in || 3600) - 60) * 1000
  }
  return accessToken.value
}

const sheetsRequest = async (path, options = {}) => {
  const token = await getAccessToken()
  const res = await fetch(`${SHEETS_API}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeout: 30 * 1000
  })
  const json = await res.json()
  if (!res.ok) {
    const message = (json.error && (json.error.message || json.error.status)) || res.statusText
    throw new Error(i18n.parse(text().apiFailed, { message }))
  }
  return json
}

const createSpreadsheet = async (uid) => {
  const created = await sheetsRequest('', {
    method: 'POST',
    body: {
      properties: { title: i18n.parse(text().newFileTitle, { uid }) },
      sheets: SHEET_LAYOUTS.map((layout, index) => ({
        properties: {
          title: layout.title,
          index,
          gridProperties: { frozenRowCount: 1 }
        },
        data: [{
          startRow: 0,
          startColumn: 0,
          rowData: [{
            values: layout.header.map(title => ({
              userEnteredValue: { stringValue: title },
              userEnteredFormat: { textFormat: { bold: true } }
            }))
          }]
        }]
      }))
    }
  })
  return created.spreadsheetId
}

const describeError = (layout, result) => {
  const signature = result.detail.signature
  return i18n.parse(text().errorAnchor, {
    sheet: layout.title,
    depth: String(signature.length),
    items: signature.map(item => item.name).join(', ')
  })
}

const ensureGridSize = async (spreadsheetId, props, rows, columns) => {
  const grid = props.gridProperties || {}
  const requests = []
  if ((grid.rowCount || 0) < rows) {
    requests.push({ appendDimension: { sheetId: props.sheetId, dimension: 'ROWS', length: rows - (grid.rowCount || 0) } })
  }
  if ((grid.columnCount || 0) < columns) {
    requests.push({ appendDimension: { sheetId: props.sheetId, dimension: 'COLUMNS', length: columns - (grid.columnCount || 0) } })
  }
  if (!requests.length) return
  await sheetsRequest(`/${spreadsheetId}:batchUpdate`, { method: 'POST', body: { requests } })
  props.gridProperties = { ...grid, rowCount: Math.max(grid.rowCount || 0, rows), columnCount: Math.max(grid.columnCount || 0, columns) }
}

const normalizeTitle = (title) => String(title == null ? '' : title).trim().toLowerCase()

const start = async () => {
  const { dataMap, current } = getData()
  const data = dataMap.get(current)
  if (!data) throw new Error(text().noData)

  let spreadsheetId = config.googleSpreadsheetId
  let created = false
  if (!spreadsheetId) {
    sendMsg(text().creating)
    spreadsheetId = await createSpreadsheet(data.uid)
    config.googleSpreadsheetId = spreadsheetId
    await config.save()
    created = true
  }

  const meta = await sheetsRequest(`/${spreadsheetId}?fields=sheets.properties(sheetId,title,gridProperties)`)
  const titles = new Map(meta.sheets.map(item => [normalizeTitle(item.properties.title), item.properties.title]))
  const sheetProps = new Map(meta.sheets.map(item => [item.properties.title, item.properties]))

  const fallbackBanner = config.googleBannerName || ''
  let resolveBanner = () => fallbackBanner
  try {
    sendMsg(text().schedule)
    resolveBanner = await createResolver({ uid: data.uid, lang: data.lang, fallback: fallbackBanner })
  } catch (e) {
    /* Losing the schedule only costs the Banner column; the export itself is still valid. */
    sendMsg(i18n.parse(text().scheduleFailed, { message: e.message }), 'ERROR')
  }

  const summary = []
  for (const layout of SHEET_LAYOUTS) {
    const title = titles.get(normalizeTitle(layout.title))
    if (!title) {
      summary.push({ title: layout.title, added: 0, skipped: true })
      continue
    }

    const records = data.result.get(layout.gachaType) || []
    const lastColumn = columnLetter(layout.width)
    const readRange = `${quoteTitle(title)}!A1:${lastColumn}`

    sendMsg(i18n.parse(text().reading, { sheet: title }))
    const existing = await sheetsRequest(`/${spreadsheetId}/values/${encodeURIComponent(readRange)}`)
    const sheetValues = existing.values || []
    const headerRow = sheetValues[0] || []

    /* The tab predates the Time Received column, so label it the first time we use it. */
    const timeHeader = layout.header[layout.timeIndex]
    if (String(headerRow[layout.timeIndex] || '').trim() !== timeHeader) {
      const cell = `${quoteTitle(title)}!${columnLetter(layout.timeIndex + 1)}1`
      await sheetsRequest(`/${spreadsheetId}/values/${encodeURIComponent(cell)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: { range: cell, majorDimension: 'ROWS', values: [[timeHeader]] }
      })
    }

    const result = buildAppendRows(layout, sheetValues.slice(1), records, resolveBanner)
    if (result.error) throw new Error(describeError(layout, result))

    if (!result.rows.length) {
      summary.push({ title, added: 0 })
      continue
    }

    const startRow = result.existingCount + 2
    const endRow = startRow + result.rows.length - 1
    const writeRange = `${quoteTitle(title)}!A${startRow}:${lastColumn}${endRow}`

    await ensureGridSize(spreadsheetId, sheetProps.get(title), endRow, layout.width)

    sendMsg(i18n.parse(text().writing, { sheet: title, count: String(result.rows.length) }))
    await sheetsRequest(`/${spreadsheetId}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      body: { range: writeRange, majorDimension: 'ROWS', values: result.rows }
    })

    summary.push({ title, added: result.rows.length, drift: result.drift })
  }

  return {
    created,
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    summary
  }
}

ipcMain.handle('GOOGLE_SHEETS_STATUS', () => {
  return {
    hasClientId: !!config.googleClientId,
    hasClientSecret: !!config.googleClientSecret,
    connected: !!config.googleRefreshToken,
    clientId: config.googleClientId || '',
    spreadsheetId: config.googleSpreadsheetId || '',
    bannerName: config.googleBannerName || ''
  }
})

ipcMain.handle('GOOGLE_SHEETS_SAVE', async (event, payload = {}) => {
  if (typeof payload.clientId === 'string') config.googleClientId = payload.clientId.trim()
  if (typeof payload.clientSecret === 'string' && payload.clientSecret) {
    writeSecret('googleClientSecret', payload.clientSecret.trim())
  }
  if (typeof payload.spreadsheetId === 'string') {
    const match = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(payload.spreadsheetId)
    config.googleSpreadsheetId = match ? match[1] : payload.spreadsheetId.trim()
  }
  if (typeof payload.bannerName === 'string') config.googleBannerName = payload.bannerName.trim()
  await config.save()
})

ipcMain.handle('GOOGLE_SHEETS_CONNECT', async () => {
  accessToken = { value: '', expiresAt: 0 }
  await authorize()
})

ipcMain.handle('GOOGLE_SHEETS_DISCONNECT', async () => {
  accessToken = { value: '', expiresAt: 0 }
  writeSecret('googleRefreshToken', '')
  await config.save()
})

ipcMain.handle('GOOGLE_SHEETS_EXPORT', async () => {
  return await start()
})

const readGoogleSheetTabs = async () => {
  const spreadsheetId = config.googleSpreadsheetId
  if (!spreadsheetId) throw new Error(text().noSpreadsheet)
  const meta = await sheetsRequest(`/${spreadsheetId}?fields=sheets.properties.title`)
  const titles = new Map(meta.sheets.map(item => [normalizeTitle(item.properties.title), item.properties.title]))
  const tabs = []
  for (const layout of SHEET_LAYOUTS) {
    const title = titles.get(normalizeTitle(layout.title))
    if (!title) continue
    sendMsg(i18n.parse(text().reading, { sheet: title }))
    const range = `${quoteTitle(title)}!A1:${columnLetter(layout.width)}`
    const values = (await sheetsRequest(`/${spreadsheetId}/values/${encodeURIComponent(range)}`)).values || []
    tabs.push({ layout, title, rows: values.slice(1) })
  }
  return tabs
}

exports.exportToGoogleSheets = start
exports.readGoogleSheetTabs = readGoogleSheetTabs
