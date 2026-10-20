// preview.js v0.1.0: next-race preview for Cup Standings. Track facts and layout from NASCAR's track feed,
// recent history at the track from past weekend feeds, and the driver to watch from The Grade.
(function (root) {
  'use strict';
  const CDN = 'https://cf.nascar.com/cacher';
  const FIRST_YEAR = 2017;          // first season with full weekend feeds
  const HISTORY_RACES = 8;          // most recent Cup races at the track to study
  const MIN_TRACK_STARTS = 3;       // starts needed to rank a driver's form at the track
  const LATE_LAPS = 20;             // "closing laps" window for when the action comes
  const cache = new Map();

  async function getJSON(url) {
    if (cache.has(url)) return cache.get(url);
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`NASCAR feed returned ${res.status} for ${url.replace(CDN, '')}`);
    const json = await res.json();
    cache.set(url, json);
    return json;
  }
  const winnerOf = (race) => race.results.find((r) => r.finishing_position === 1) || null;
  const raceOf = (w) => (w && w.weekend_race && w.weekend_race[0] && (w.weekend_race[0].results || []).length ? w.weekend_race[0] : null);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  // Next race: the one on track now, otherwise the first points race without a winner.
  function nextRace(off, liveRace) {
    if (liveRace) return liveRace.meta;
    return off.list.filter((m) => m.race_type_id === 1 && !m.winner_driver_id)
      .sort((a, b) => a.date_scheduled.localeCompare(b.date_scheduled))[0] || null;
  }

  async function pastRacesAt(trackId, year, currentList) {
    const years = [];
    for (let y = year - 1; y >= FIRST_YEAR; y--) years.push(y);
    const lists = await Promise.all(years.map((y) => getJSON(`${CDN}/${y}/1/race_list_basic.json`).then((l) => l.map((m) => ({ ...m, season: y }))).catch(() => [])));
    const current = currentList.filter((m) => m.winner_driver_id).map((m) => ({ ...m, season: year }));
    const metas = current.concat(...lists).filter((m) => m.track_id === trackId && m.race_type_id === 1)
      .sort((a, b) => b.date_scheduled.localeCompare(a.date_scheduled));
    const feeds = await Promise.all(metas.map((m) => getJSON(`${CDN}/${m.season}/1/${m.race_id}/weekend-feed.json`).then(raceOf).catch(() => null)));
    return metas.map((m, i) => ({ meta: m, race: feeds[i] })).filter((x) => x.race).slice(0, HISTORY_RACES);
  }

  // Which part of the race each non-stage caution and each lead change fell in.
  function phaseOf(lap, race) {
    const s1 = race.stage_1_laps || 0, s2 = s1 + (race.stage_2_laps || 0), total = race.actual_laps || race.scheduled_laps;
    if (lap > total - LATE_LAPS) return 'late';
    if (s1 && lap <= s1) return 's1';
    if (s2 && lap <= s2) return 's2';
    return 's3';
  }
  function actionTiming(history) {
    const phases = { s1: 0, s2: 0, s3: 0, late: 0 }, leads = { s1: 0, s2: 0, s3: 0, late: 0 };
    let cautions = 0, changes = 0;
    history.forEach(({ race }) => {
      (race.caution_segments || []).filter((c) => !/competition|stage/i.test(`${c.reason} ${c.comment}`)).forEach((c) => { phases[phaseOf(c.start_lap, race)]++; cautions++; });
      (race.race_leaders || []).slice(1).forEach((l) => { leads[phaseOf(l.start_lap, race)]++; changes++; });
    });
    const share = (o, n) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, n ? v / n : 0]));
    return { cautions: share(phases, cautions), leads: share(leads, changes), cautionCount: cautions, changeCount: changes };
  }

  function trends(history) {
    const metas = history.map((h) => h.race);
    const winners = history.map((h) => winnerOf(h.race)).filter(Boolean);
    const margins = metas.map((r) => parseFloat(r.margin_of_victory)).filter((x) => !Number.isNaN(x));
    return {
      races: history.length,
      cautions: mean(metas.map((r) => r.number_of_cautions || 0)),
      cautionLaps: mean(metas.map((r) => r.number_of_caution_laps || 0)),
      leadChanges: mean(metas.map((r) => r.number_of_lead_changes || 0)),
      leaders: mean(metas.map((r) => r.number_of_leaders || 0)),
      winnerStart: mean(winners.map((w) => w.starting_position || 0)),
      deepWins: winners.filter((w) => w.starting_position > 10).length,
      cautionFinishes: metas.filter((r) => /caution/i.test(String(r.margin_of_victory))).length,
      closeFinishes: margins.filter((m) => m < 0.1).length,
    };
  }

  // Form at the track for every driver on NASCAR's points list.
  function driverForm(history, roster) {
    const rows = new Map();
    history.forEach(({ race }) => race.results.forEach((r) => {
      if (roster && !roster.has(r.driver_id)) return;
      const cur = rows.get(r.driver_id) || { id: r.driver_id, starts: 0, wins: 0, t5: 0, t10: 0, finishes: [], led: 0 };
      rows.set(r.driver_id, { ...cur, starts: cur.starts + 1, wins: cur.wins + (r.finishing_position === 1), t5: cur.t5 + (r.finishing_position <= 5),
        t10: cur.t10 + (r.finishing_position <= 10), finishes: cur.finishes.concat(r.finishing_position), led: cur.led + (r.laps_led || 0) });
    }));
    return [...rows.values()].filter((r) => r.starts >= MIN_TRACK_STARTS).map((r) => ({ ...r, avg: mean(r.finishes) }))
      .sort((a, b) => a.avg - b.avg || b.wins - a.wins);
  }

  // Driver to watch: Grade contenders still alive for the real title who are furthest from safety,
  // measured in race wins needed per race left, averaged over every format where they are still in it.
  function watchList(results, grades, formats) {
    const chase = results.chase26;
    const remaining = Math.max(1, chase.remaining);
    return grades.filter((g) => g.score >= 55).map((g) => { // C+ or better: real Grade contenders
      const notes = [];
      let need = 0, alive = 0;
      formats.forEach((f) => {
        const res = results[f.key];
        const idx = res.rows.findIndex((r) => r.id === g.id);
        const row = res.rows[idx];
        if (!row || !['alive', 'chase', 'projected', 'season'].includes(row.status)) return;
        const per = g.per[f.key];
        if (per.title < 70 && row.status !== 'season') return;
        if (row.status === 'season' && per.title === 0) return;
        alive++;
        const belowCut = res.cut && !res.locked && idx >= res.cut;
        const deficit = belowCut ? res.rows[res.cut - 1].pts - row.pts : res.rows[0].pts - row.pts;
        const wins = Math.max(0, deficit) / res.scale.avgWin;
        need += wins / Math.max(1, res.remaining || remaining);
        if (belowCut) notes.push({ fmt: f, points: Math.round(deficit) });
      });
      const off = chase.rows.findIndex((r) => r.id === g.id);
      const chaseRow = chase.rows[off];
      const chaseGap = chaseRow ? chase.rows[0].pts - chaseRow.pts : null;
      return { id: g.id, grade: g, need: alive ? need / alive : 0, alive, notes, chasePos: off + 1, chaseGap, chaseWins: chaseGap == null ? null : chaseGap / chase.scale.avgWin, remaining: chase.remaining, inChase: !!chaseRow && chaseRow.status === 'chase' };
    }).filter((w) => w.inChase && w.chaseGap > 0 && w.alive > 0).sort((a, b) => b.need - a.need);
  }

  async function load(off, liveRace, results, grades, formats) {
    const next = nextRace(off, liveRace);
    if (!next) return null;
    const [tracks, history] = await Promise.all([
      getJSON(`${CDN}/tracks.json`).then((t) => ((t && t.items) || [])).catch(() => []),
      pastRacesAt(next.track_id, off.year, off.list),
    ]);
    const track = tracks.find((t) => t.track_id === next.track_id) || null;
    return { next, track, history, trends: trends(history), timing: actionTiming(history), form: driverForm(history, off.roster), watch: watchList(results, grades, formats) };
  }

  const api = { load, winnerOf, LATE_LAPS, HISTORY_RACES, MIN_TRACK_STARTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CupPreview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
