const SHEET_LAYOUTS = [
  {
    gachaType: "301",
    title: "Event wish",
    header: [
      "No.",
      "Pity 5",
      "Pity 4",
      "type",
      "Item",
      "Banner",
      "Time Received",
    ],
    width: 7,
    rarityIndex: 3,
    nameIndex: 4,
    bannerIndex: 5,
    timeIndex: 6,
    pity4: true,
    banner: true,
  },
  {
    gachaType: "302",
    title: "Weapon ",
    header: ["No.", "Pity", "Type", "Item", "Time Received"],
    width: 5,
    rarityIndex: 2,
    nameIndex: 3,
    bannerIndex: -1,
    timeIndex: 4,
    pity4: false,
    banner: false,
  },
  {
    gachaType: "200",
    title: "Permanent",
    header: ["No.", "Pity", "type", "Item", "Time Received"],
    width: 5,
    rarityIndex: 2,
    nameIndex: 3,
    bannerIndex: -1,
    timeIndex: 4,
    pity4: false,
    banner: false,
  },
];

const quoteTitle = (title) => `'${title.replace(/'/g, "''")}'`;

const columnLetter = (index) => {
  let result = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
};

const rarityLabel = (rank) => `${rank} star`;

const parseRarity = (value) => {
  const match = /(\d)\s*star/i.exec(String(value == null ? "" : value));
  return match ? Number(match[1]) : 0;
};

const toNumber = (value) => {
  const num = Number(
    String(value == null ? "" : value).replace(/[^\d.-]/g, ""),
  );
  return Number.isFinite(num) ? num : 0;
};

const isBlankRow = (row, layout) => {
  if (!row) return true;
  for (let i = 0; i < layout.width; i++) {
    if (String(row[i] == null ? "" : row[i]).trim() !== "") return false;
  }
  return true;
};

const trimTrailingBlanks = (rows, layout) => {
  const result = rows.slice();
  while (result.length && isBlankRow(result[result.length - 1], layout)) {
    result.pop();
  }
  return result;
};

const readName = (row, layout) =>
  String(
    (row && row[layout.nameIndex]) == null ? "" : row[layout.nameIndex],
  ).trim();

const ANCHOR_DEPTH = 5;

const rowSignature = (row, layout) => ({
  name: readName(row, layout),
  rank: parseRarity(row[layout.rarityIndex]),
});

const recordMatchesSignature = (record, signature) => {
  const name = String(record[1] == null ? "" : record[1]).trim();
  if (name.toLowerCase() !== signature.name.toLowerCase()) return false;

  if (signature.rank > 0 && Number(record[3]) !== signature.rank) return false;
  return true;
};

const findAnchor = (layout, existingRows, records, depth = ANCHOR_DEPTH) => {
  const count = existingRows.length;
  if (!count)
    return {
      startIndex: 0,
      anchorAt: 0,
      expected: 0,
      candidates: 1,
      signature: [],
    };

  const size = Math.min(depth, count);
  const signature = existingRows
    .slice(count - size)
    .map((row) => rowSignature(row, layout));

  const candidates = [];
  for (let start = 0; start + size <= records.length; start++) {
    let matched = true;
    for (let i = 0; i < size; i++) {
      if (!recordMatchesSignature(records[start + i], signature[i])) {
        matched = false;
        break;
      }
    }
    if (matched) candidates.push(start);
  }

  if (!candidates.length) {
    return { startIndex: -1, candidates: 0, signature };
  }

  const expected = count - size;
  const anchorAt = candidates.reduce(
    (best, current) =>
      Math.abs(current - expected) < Math.abs(best - expected) ? current : best,
    candidates[0],
  );

  return {
    startIndex: anchorAt + size,
    anchorAt,
    expected,
    candidates: candidates.length,
    signature,
  };
};

const readTailState = (layout, existingRows) => {
  if (!existingRows.length) {
    return { no: 0, pity5: 0, pity4: 0, lastRank: 0 };
  }
  const last = existingRows[existingRows.length - 1];
  return {
    no: toNumber(last[0]),
    pity5: toNumber(last[1]),
    pity4: layout.pity4 ? toNumber(last[2]) : 0,
    lastRank: parseRarity(last[layout.rarityIndex]),
  };
};

const buildAppendRows = (layout, sheetRows, records, banner = "") => {
  const resolveBanner = typeof banner === "function" ? banner : () => banner;
  const existingRows = trimTrailingBlanks(sheetRows || [], layout);
  const existingCount = existingRows.length;

  const anchor = findAnchor(layout, existingRows, records);
  if (anchor.startIndex < 0) {
    return {
      rows: [],
      existingCount,
      error: "anchor",
      detail: { signature: anchor.signature },
    };
  }

  const state = readTailState(layout, existingRows);
  let { no, pity5, pity4, lastRank } = state;
  const rows = [];

  for (let i = anchor.startIndex; i < records.length; i++) {
    const record = records[i];
    const rank = Number(record[3]);

    no += 1;
    pity5 = lastRank === 5 ? 1 : pity5 + 1;
    pity4 = lastRank >= 4 ? 1 : pity4 + 1;

    const row = layout.pity4
      ? [no, pity5, pity4, rarityLabel(rank), record[1]]
      : [no, pity5, rarityLabel(rank), record[1]];
    if (layout.banner) row.push(resolveBanner(record));
    row.push(record[0]);
    rows.push(row);

    lastRank = rank;
  }

  return {
    rows,
    existingCount,
    startIndex: anchor.startIndex,
    drift: existingCount - anchor.startIndex,
    candidates: anchor.candidates,
    error: null,
    detail: null,
  };
};

module.exports = {
  SHEET_LAYOUTS,
  ANCHOR_DEPTH,
  rarityLabel,
  parseRarity,
  buildAppendRows,
  findAnchor,
  readTailState,
  trimTrailingBlanks,
  quoteTitle,
  columnLetter,
};
