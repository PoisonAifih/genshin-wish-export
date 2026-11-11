const fetch = require("electron-fetch").default;
const { readJSON, saveJSON, sendMsg } = require("./utils");
const { normalizeSchedule, buildResolver } = require("./bannerResolve");

const SCHEDULE_URL =
  "https://raw.githubusercontent.com/BTMuli/TeyvatGuide/master/src/data/app/gacha.json";
const DICT_URL = "https://api.uigf.org/dict/genshin/all.json";
const CACHE_FILE = "banner-schedule.json";
const ALIAS_FILE = "banner-aliases.json";
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

let schedule = null;

const fetchJSON = async (url) => {
  const res = await fetch(url, { timeout: 30 * 1000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
};

const download = async () => {
  const [raw, dict] = await Promise.all([
    fetchJSON(SCHEDULE_URL),
    fetchJSON(DICT_URL),
  ]);
  const data = { time: Date.now(), banners: normalizeSchedule(raw), dict };
  if (!data.banners.length) throw new Error("empty banner schedule");
  await saveJSON(CACHE_FILE, data);
  return data;
};

const load = async (forceRefresh = false) => {
  if (schedule && !forceRefresh) return schedule;

  if (!forceRefresh) {
    const cached = await readJSON(CACHE_FILE);
    if (
      cached &&
      cached.banners &&
      cached.banners.length &&
      Date.now() - cached.time < CACHE_MAX_AGE
    ) {
      schedule = cached;
      return schedule;
    }
  }

  try {
    schedule = await download();
  } catch (e) {
    /* A stale cache still resolves every banner except the newest one, which beats
       failing the export because GitHub happened to be unreachable. */
    const cached = await readJSON(CACHE_FILE);
    if (!cached || !cached.banners || !cached.banners.length) throw e;
    sendMsg(
      `Banner schedule refresh failed, using cached copy: ${e.message}`,
      "ERROR",
    );
    schedule = cached;
  }
  return schedule;
};

const createResolver = async ({
  uid,
  lang,
  fallback = "",
  forceRefresh = false,
}) => {
  const data = await load(forceRefresh);
  const aliases = (await readJSON(ALIAS_FILE)) || {};
  return buildResolver({
    banners: data.banners,
    dict: data.dict,
    uid,
    lang,
    fallback,
    aliases,
  });
};

module.exports = { createResolver, load, ALIAS_FILE };
