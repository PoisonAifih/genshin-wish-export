const { ipcMain } = require('electron')
const fs = require('fs-extra')
const path = require('path')
const { getData, saveData } = require('./getData')
const { userDataPath } = require('./utils')
const i18n = require('./i18n')
const { trimTrailingBlanks, parseRarity } = require('./googleSheetsFormat')

const text = () => i18n.historyImport

const MATCH_DEPTH = 11

/* Standard-pool weapons, so old rows can be typed even if they never show up in the fetched history. */
const STANDARD_WEAPONS_5 = [
  'Aquila Favonia', "Wolf's Gravestone", 'Lost Prayer to the Sacred Winds', 'Primordial Jade Winged-Spear',
  "Amos' Bow", 'Skyward Blade', 'Skyward Pride', 'Skyward Spine', 'Skyward Atlas', 'Skyward Harp'
]
const STANDARD_WEAPONS_4 = [
  'The Flute', "Lion's Roar", 'Sacrificial Sword', 'Favonius Sword', 'The Bell', 'Rainslasher',
  'Sacrificial Greatsword', 'Favonius Greatsword', "Dragon's Bane", 'Favonius Lance',
  'Eye of Perception', 'Favonius Codex', 'Sacrificial Fragments', 'The Widsith', 'Rust',
  'Favonius Warbow', 'Sacrificial Bow', 'The Stringless'
]

const cell = (row, index) => String(row && row[index] != null ? row[index] : '').trim()

const normalize = (name) => String(name).toLowerCase().replace(/[\s'’\-.]/g, '')

const withinOneEdit = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/* Learns spellings and character/weapon types from the fetched history, which comes from the
   game and is always spelled correctly. Old hand-typed rows are snapped onto these names. */
const createCatalog = (data) => {
  const names = new Map()
  let weaponType = ''
  let characterType = ''
  for (const records of data.result.values()) {
    for (const record of records) {
      if (record[3] === 3) weaponType = record[2]
      names.set(normalize(record[1]), { name: record[1], type: record[2], rank: Number(record[3]) })
    }
  }
  for (const entry of names.values()) {
    if (entry.type && entry.type !== weaponType) {
      characterType = entry.type
      break
    }
  }
  const weapon = weaponType || 'Weapon'
  const character = characterType || 'Character'
  const standard = [...STANDARD_WEAPONS_5.map(name => [name, 5]), ...STANDARD_WEAPONS_4.map(name => [name, 4])]
  for (const [name, rank] of standard) {
    if (!names.has(normalize(name))) names.set(normalize(name), { name, type: weapon, rank })
  }

  const lookup = (raw) => {
    const key = normalize(raw)
    if (names.has(key)) return names.get(key)
    if (key.length < 6) return null
    const close = [...names.keys()].filter(other => other.length >= 6 && withinOneEdit(key, other))
    return close.length === 1 ? names.get(close[0]) : null
  }

  return { lookup, names, weapon, character }
}

const rowMatchesRecord = (row, layout, record) => {
  if (cell(row, layout.nameIndex).toLowerCase() !== String(record[1]).trim().toLowerCase()) return false
  const rank = parseRarity(row[layout.rarityIndex])
  return !rank || rank === Number(record[3])
}

/* Where the fetched history should start in the sheet: taken from the first sheet row that
   carries a timestamp found in the local history, else from the row counts. */
const estimateStart = (layout, rows, records) => {
  const index = new Map(records.map((record, i) => [`${new Date(record[0]).getTime()}|${String(record[1]).toLowerCase()}`, i]))
  for (let r = 0; r < rows.length; r++) {
    const time = new Date(cell(rows[r], layout.timeIndex)).getTime()
    if (!time) continue
    const i = index.get(`${time}|${cell(rows[r], layout.nameIndex).toLowerCase()}`)
    if (i !== undefined) return r - i
  }
  return rows.length - records.length
}

/* Finds where the fetched history begins inside the sheet; everything above it is older.
   Hand-kept trackers have the odd typo or missed row, so a couple of mismatches are allowed. */
const findOverlap = (layout, rows, records) => {
  if (!records.length) return rows.length
  const depth = Math.min(MATCH_DEPTH, records.length)
  const required = depth >= MATCH_DEPTH ? depth - 2 : depth
  const expected = estimateStart(layout, rows, records)
  let best = -1
  let bestScore = 0
  for (let start = 0; start + depth <= rows.length; start++) {
    let score = 0
    for (let i = 0; i < depth; i++) {
      if (rowMatchesRecord(rows[start + i], layout, records[i])) score++
    }
    if (score < required) continue
    if (score > bestScore || (score === bestScore && Math.abs(start - expected) < Math.abs(best - expected))) {
      best = start
      bestScore = score
    }
  }
  return best
}

/* Unknown names default to characters, except on the weapon banner, where they are weapons
   unless another banner already showed the same name as a character. */
const toRecord = (row, layout, catalog) => {
  const raw = cell(row, layout.nameIndex)
  const known = catalog.lookup(raw)
  /* Some early rows hold the weapon class ("Sword", "Catalyst") instead of the rarity. */
  const rank = parseRarity(row[layout.rarityIndex]) || (known && known.rank) || 3
  let name = known ? known.name : raw
  let type = known && known.type
  if (!type) {
    type = rank === 3 || layout.gachaType === '302' ? catalog.weapon : catalog.character
    if (rank >= 4) catalog.names.set(normalize(name), { name, type, rank })
  }
  return [cell(row, layout.timeIndex), name, type, rank, layout.gachaType, '']
}

const backupLocal = async (uid) => {
  const file = path.join(userDataPath, `gacha-list-${uid}.json`)
  if (!(await fs.pathExists(file))) return
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15)
  await fs.copy(file, path.join(userDataPath, 'backup', String(uid), `gacha-list-${uid}-${stamp}.json`))
}

const start = async (source) => {
  const { dataMap, current } = getData()
  const data = dataMap.get(current)
  if (!data) throw new Error(text().noData)

  const tabs = source === 'sheets'
    ? await require('./googleSheets').readGoogleSheetTabs()
    : await require('./workbookAppend').readWorkbookTabs()
  if (!tabs.length) throw new Error(text().noTabs)

  const catalog = createCatalog(data)
  const plans = []
  const weaponBannerLast = [...tabs].sort((a, b) => (a.layout.gachaType === '302') - (b.layout.gachaType === '302'))
  for (const { layout, title, rows: rawRows } of weaponBannerLast) {
    const rows = trimTrailingBlanks(rawRows, layout).filter(row => cell(row, layout.nameIndex))
    const records = (data.result.get(layout.gachaType) || []).filter(record => record[5])
    const overlap = findOverlap(layout, rows, records)
    if (overlap < 0) {
      throw new Error(i18n.parse(text().noMatch, {
        sheet: title.trim(),
        items: records.slice(0, 5).map(record => record[1]).join(', ')
      }))
    }
    plans.push({ layout, title: title.trim(), older: rows.slice(0, overlap).map(row => toRecord(row, layout, catalog)) })
  }

  const added = plans.reduce((sum, plan) => sum + plan.older.length, 0)
  const previous = [...data.result.values()].reduce((sum, list) => sum + list.filter(record => !record[5]).length, 0)
  if (added || previous) {
    await backupLocal(data.uid)
    for (const { layout, older } of plans) {
      data.result.set(layout.gachaType, older.concat((data.result.get(layout.gachaType) || []).filter(record => record[5])))
    }
    await saveData(data)
  }

  return { added, summary: plans.map(plan => ({ title: plan.title, added: plan.older.length })) }
}

ipcMain.handle('HISTORY_IMPORT', async (event, source) => await start(source))
