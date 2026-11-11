const DICT_LANG = new Map([
  ["zh-cn", "chs"],
  ["zh-tw", "cht"],
  ["de", "de"],
  ["en", "en"],
  ["es", "es"],
  ["fr", "fr"],
  ["id", "id"],
  ["ja", "jp"],
  ["ko", "kr"],
  ["pt", "pt"],
  ["ru", "ru"],
  ["th", "th"],
  ["vi", "vi"],
]);

const timezoneOf = (uid) => {
  const prefix = String(uid == null ? "" : uid).charAt(0);
  if (prefix === "6") return -5;
  if (prefix === "7") return 1;
  return 8;
};

const dictLangOf = (lang) => {
  const key = String(lang || "en").toLowerCase();
  return DICT_LANG.get(key) || DICT_LANG.get(key.split("-")[0]) || "en";
};

// wish timezone to epoch milliseconds
const parseWishTime = (time, offsetHours) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
    String(time == null ? "" : time),
  );
  if (!match) return NaN;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  const h = Number(match[4]);
  const mi = Number(match[5]);
  const s = Number(match[6]);
  return Date.UTC(y, mo - 1, d, h - offsetHours, mi, s);
};

const normalizeSchedule = (raw) =>
  (raw || [])
    .filter((item) => Array.isArray(item.up5List) && item.up5List.length)
    .map((item) => ({
      type: String(item.type),
      from: Date.parse(item.from),
      to: Date.parse(item.to),
      up5: String(item.up5List[0]),
      version: item.version,
    }))
    .filter((item) => Number.isFinite(item.from) && Number.isFinite(item.to));

const buildResolver = ({
  banners,
  dict,
  uid,
  lang,
  fallback = "",
  aliases = {},
}) => {
  const offset = timezoneOf(uid);
  const names = (dict && (dict[dictLangOf(lang)] || dict.en)) || {};
  const byId = new Map(
    Object.entries(names).map(([name, id]) => [String(id), name]),
  );

  return (record) => {
    const at = parseWishTime(record[0], offset);
    if (!Number.isFinite(at)) return fallback;

    const gachaType = String(record[4]);
    const banner = banners.find(
      (item) => item.type === gachaType && at >= item.from && at <= item.to,
    );
    if (!banner) return fallback;

    const name = byId.get(banner.up5);
    if (!name) return fallback;
    return aliases[name] || name;
  };
};

module.exports = {
  timezoneOf,
  dictLangOf,
  parseWishTime,
  normalizeSchedule,
  buildResolver,
};
