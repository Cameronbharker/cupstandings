// data.js v0.2.0: NASCAR feed loading, live race assembly and season scoring for Cup Standings.
(function (root) {
  'use strict';
  const E = root.PointsEngine;
  const CDN = 'https://cf.nascar.com';
  const MAKES = { Tyt: 'Toyota', Chv: 'Chevrolet', Frd: 'Ford' };
  const FLAGS = { 1: 'Green', 2: 'Caution', 3: 'Red Flag', 4: 'White Flag', 8: 'Warm Up', 9: 'Checkered' };
  const CHECKERED = 9;
  const cache = new Map();
  let people = null; // driver photos from NASCAR's driver feed, loaded once

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`NASCAR feed returned ${res.status} for ${url.replace(CDN, '')}`);
    return res.json();
  }
  const hasResults = (w) => !!(w && w.weekend_race && w.weekend_race[0] && (w.weekend_race[0].results || []).length);

  // Seasons before NASCAR's feeds (1968-2016) come from data/history/<year>.json (build-history.py),
  // reshaped into NASCAR's own race-list and weekend-feed shape so the engine scores them unchanged.
  const FEED_FIRST_YEAR = 2017;
  async function loadHistory(year) {
    const h = await getJSON(`data/history/${year}.json`);
    const col = Object.fromEntries(h.fields.map((f, i) => [f, i]));
    const noPoints = h.races.every((r) => r.results.every((x) => x[col.pts] == null));   // 1974 paid by purse, no points recorded
    const list = [], weekends = {};
    h.races.forEach((r) => {
      const id = year * 1000 + r.race;
      const winner = r.results.find((x) => x[col.finish] === 1);
      const laps = Math.max(0, ...r.results.map((x) => x[col.laps] || 0));
      const meta = { race_id: id, race_season: year, race_name: r.name, track_name: r.track, track_id: null, race_type_id: 1,
        date_scheduled: `${year}-${String(r.race).padStart(3, '0')}`, race_date: null, scheduled_laps: laps, scheduled_distance: Math.round(r.length * laps * 10) / 10,
        winner_driver_id: winner ? `h:${winner[col.driver]}` : null, historic: true };
      const results = r.results.map((x) => ({
        driver_id: `h:${x[col.driver]}`, driver_fullname: x[col.driver], car_number: x[col.car], team_name: x[col.team], car_make: x[col.make],
        finishing_position: x[col.finish], starting_position: x[col.start], laps_led: x[col.led] || 0, laps_completed: x[col.laps] || 0,
        finishing_status: x[col.status], points_earned: noPoints ? 1 : (x[col.pts] || 0),
      }));
      list.push(meta);
      weekends[id] = { weekend_race: [{ ...meta, actual_laps: laps, actual_distance: meta.scheduled_distance, results, stage_results: [] }] };
    });
    return { year, list, official: null, weekends, roster: null, missing: [], people: people || new Map(), historic: true, source: h.source };
  }

  // Official layer: schedule, every finished race, NASCAR's points list. Changes once per race.
  async function loadOfficial(year, isCurrent) {
    if (year < FEED_FIRST_YEAR) { if (!people) people = await loadPeople(); return loadHistory(year); }
    const [list, official] = await Promise.all([
      getJSON(`${CDN}/cacher/${year}/1/race_list_basic.json`),
      isCurrent ? getJSON(`${CDN}/cacher/${year}/1/racinginsights-points-feed.json`).catch(() => null) : null,
    ]);
    const finished = list.filter((m) => m.winner_driver_id && (m.race_type_id === 1 || /duel/i.test(m.race_name)));
    const newest = finished.reduce((a, m) => (!a || m.date_scheduled > a.date_scheduled ? m : a), null);
    const weekends = {};
    await Promise.all(finished.map(async (m) => {
      const key = `${year}/${m.race_id}`;
      const fresh = cache.has(key) && hasResults(cache.get(key)) && m !== newest;
      if (!fresh) cache.set(key, await getJSON(`${CDN}/cacher/${year}/1/${m.race_id}/weekend-feed.json`));
      weekends[m.race_id] = cache.get(key);
    }));
    if (!people) people = await loadPeople();
    const roster = official && official.length ? new Set(official.map((o) => o.driver_id)) : null;
    const missing = list.filter((m) => m.race_type_id === 1 && m.winner_driver_id && !hasResults(weekends[m.race_id]));
    return { year, list, official, weekends, roster, missing, people };
  }

  // NASCAR's driver feed, keyed by NASCAR id and by name (historic seasons only carry names).
  // Cup entries first so a Cup portrait wins over the same driver's other-series entry.
  const normName = (n) => String(n || '').toLowerCase().replace(/\s*\(.*?\)|[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  async function loadPeople() {
    try {
      const feed = await getJSON(`${CDN}/cacher/drivers.json`);
      const rows = ((feed && feed.response) || []).slice().sort((a, b) => (b.Driver_Series === 'nascar-cup-series') - (a.Driver_Series === 'nascar-cup-series'));
      const map = new Map();
      rows.forEach((r) => {
        const real = (u) => (u && !/\/media\/default|placeholder/i.test(u) ? u : '');   // NASCAR's blank stand-in image is not a photo
        const entry = { photo: real(r.Firesuit_Image) || real(r.Image), headshot: real(r.Image) };
        if (!entry.photo) return;
        if (!map.has(r.Nascar_Driver_ID)) map.set(r.Nascar_Driver_ID, entry);
        const key = `name:${normName(r.Full_Name)}`;
        if (!map.has(key)) map.set(key, entry);
      });
      return map;
    } catch (err) {
      console.error('Driver photo feed unavailable', err);
      return new Map();
    }
  }

  // Photo for any driver in any season: NASCAR stock portrait, then NASCAR headshot by name,
  // then the driver's Wikipedia photo (only when the article describes a racing driver), else none.
  const WIKI = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
  const photoCache = new Map();
  async function wikiPhoto(name) {
    for (const title of [`${name} (racing driver)`, name]) {
      try {
        const res = await fetch(WIKI + encodeURIComponent(title.replace(/ /g, '_')));
        if (!res.ok) continue;
        const page = await res.json();
        const img = page.originalimage || page.thumbnail;
        if (img && /racing|nascar|stock car|driver/i.test(`${page.description} ${page.extract}`)) return img.source;
      } catch (err) { /* try the next title */ }
    }
    return null;
  }
  async function photoFor(id, name) {
    if (photoCache.has(id)) return photoCache.get(id);
    const p = people || new Map();
    const hit = p.get(id) || p.get(`name:${normName(name)}`);
    const url = hit ? hit.photo : await wikiPhoto(String(name || ''));
    photoCache.set(id, url || null);
    return url || null;
  }

  // Live layer: running order plus NASCAR's live points. Polled every few seconds during a race.
  async function loadLive(off) {
    const live = await getJSON(`${CDN}/live/feeds/live-feed.json`).catch(() => null);
    if (!live || live.series_id !== 1 || live.run_type !== 3 || !(live.lap_number > 0)) return null;
    const meta = off.list.find((m) => m.race_id === live.race_id && m.race_type_id === 1);
    if (!meta || hasResults(off.weekends[meta.race_id])) return null;
    // Live points drive the standings; pit stops, flags and race notes feed the live race view and can fail alone.
    const extra = (url, fallback) => getJSON(url).catch((err) => { console.error('Live feed unavailable', err); return fallback; });
    const [points, pits, flags, notes] = await Promise.all([
      extra(`${CDN}/live/feeds/live-points.json`, []),
      extra(`${CDN}/live/feeds/live-pit-data.json`, []),
      extra(`${CDN}/live/feeds/live-flag-data.json`, []),
      extra(`${CDN}/cacher/${off.year}/1/${live.race_id}/lap-notes.json`, null),
    ]);
    return { live, meta, points, pits, flags, notes, flag: FLAGS[live.flag_state] || 'Live', isFinal: live.flag_state === CHECKERED };
  }

  // A race in progress, shaped like a weekend feed so the engine scores it like any finished race.
  function liveWeekend(lr, roster, year) {
    const { live, meta, points } = lr;
    const lp = new Map(points.map((p) => [p.driver_id, p]));
    const base = year >= 2026 ? E.tables.t2026 : E.tables.t2017;
    const stagesDone = Math.min(3, Math.max(0, ((live.stage && live.stage.stage_num) || 1) - 1));
    const stage_results = [];
    for (let n = 1; n <= stagesDone; n++) {
      const scored = points.filter((p) => p[`stage_${n}_points`] > 0)
        .sort((a, b) => b[`stage_${n}_points`] - a[`stage_${n}_points`])
        .map((p) => ({ driver_id: p.driver_id, finishing_position: 11 - p[`stage_${n}_points`], stage_points: p[`stage_${n}_points`] }));
      stage_results.push({ stage_number: n, results: scored });
    }
    const stagePts = (p) => (p ? [1, 2, 3].filter((n) => n <= stagesDone).reduce((s, n) => s + (p[`stage_${n}_points`] || 0), 0) : 0);
    const results = live.vehicles.map((v) => {
      const id = v.driver.driver_id;
      const p = lp.get(id);
      const eligible = p ? p.is_points_eligible : roster ? roster.has(id) : true;
      const pos = v.running_position;
      const fast = lr.isFinal && p && p.is_fastest_lap_point ? 1 : 0;
      return {
        driver_id: id, driver_fullname: v.driver.full_name, car_number: v.vehicle_number,
        car_make: MAKES[v.vehicle_manufacturer] || v.vehicle_manufacturer, team_name: '',
        finishing_position: pos, starting_position: v.starting_position,
        laps_led: (v.laps_led || []).reduce((s, l) => s + (l.end_lap - l.start_lap + 1), 0),
        laps_completed: v.laps_completed, finishing_status: v.is_on_track === false ? 'Out' : 'Running',
        points_earned: eligible ? base(pos) + stagePts(p) + fast : 0,
      };
    });
    return { weekend_race: [{ ...meta, actual_laps: live.laps_in_race, results, stage_results }] };
  }

  function score(off, weekends) {
    // Historic seasons: the season's own format uses the points NASCAR awarded (penalties included) where the
    // source carries them in full: 1968-1971 and 1975-2016. 1972-1973 lap points are not in the source, so those recompute.
    const y = off.year, awardedOk = off.historic && (y <= 1971 || (y >= 1975 && y <= 2016));
    const season = E.buildSeason(off.list, weekends, y, off.roster, { awardedFor: awardedOk ? E.officialFormat(y) : null });
    const grades = root.PointsGrade.build(season.results, season.ctx.stats, Math.max(1, Math.ceil(season.ctx.races.length / 2)));
    return { season, grades };
  }

  // Current standings plus the standings one race earlier, for the NASCAR-style +/- position arrows.
  function build(off, lr) {
    const weekends = lr ? { ...off.weekends, [lr.meta.race_id]: liveWeekend(lr, off.roster, off.year) } : off.weekends;
    const now = score(off, weekends);
    const races = now.season.ctx.races;
    const latest = races[races.length - 1];
    const prevWeekends = latest ? Object.fromEntries(Object.entries(weekends).filter(([id]) => Number(id) !== latest.id)) : weekends;
    const before = latest ? score(off, prevWeekends) : now;
    return { ...off, liveRace: lr, ...now, before, verify: lr ? null : verify(off.official, now.season.results.chase26) };
  }

  function verify(official, res) {
    if (!official) return null;
    const pos = new Map(res.rows.map((r, i) => [r.id, { pts: r.pts, pos: i + 1 }]));
    const match = official.filter((o) => { const m = pos.get(o.driver_id); return m && m.pts === o.points && m.pos === o.position; }).length;
    return { match, total: official.length };
  }

  root.CupData = { loadOfficial, loadLive, build, photoFor, CHECKERED, FLAGS, FEED_FIRST_YEAR };
})(globalThis);
