// engine.js v0.1.0: scores one NASCAR Cup season under every championship format.
// Pure functions, no DOM, no network. Loaded by index.html and by check.mjs.
(function (root) {
  'use strict';

  // ---------- per-position tables (source: Wikipedia, List of NASCAR points scoring systems) ----------
  const LATFORD_TAIL = [31, 28, 25, 20, 15, 10, 8, 6, 4, 2, 1]; // positions 44-54
  function latford(pos, winPts) {
    if (pos === 1) return winPts;
    if (pos <= 6) return 175 - 5 * (pos - 1);
    if (pos <= 11) return 150 - 4 * (pos - 6);
    if (pos <= 43) return 130 - 3 * (pos - 11);
    return LATFORD_TAIL[pos - 44] || 0;
  }
  const t2011 = (pos) => Math.max(0, 44 - pos) + (pos === 1 ? 3 : 0); // 43 + 3 to win
  const t2016 = (pos) => Math.max(0, 41 - pos) + (pos === 1 ? 3 : 0); // 40 + 3 to win
  const t2017 = (pos) => (pos === 1 ? 40 : Math.max(1, 37 - pos));     // 40, 35, 34 ... 1
  const t2026 = (pos) => (pos === 1 ? 55 : Math.max(1, 37 - pos));     // 55, 35, 34 ... 1
  const baseTableForYear = (year) => (year >= 2026 ? t2026 : t2017);

  function mileage(pos, miles) {
    const step = miles < 250 ? 1 : miles < 400 ? 2 : 3;
    return Math.max(0, step * (51 - pos));
  }
  // 1972-73 lap points by track length; exact table rows where they exist, 0.5 per mile otherwise.
  const LAP_VALUE = [[1, 0.5], [1.3, 0.7], [1.5, 0.75], [2, 1], [2.5, 1.25]];
  function perLap(lapLen) {
    if (lapLen < 0.95) return 0.25;
    const hit = LAP_VALUE.find(([len]) => Math.abs(len - lapLen) <= 0.1);
    return hit ? hit[1] : Math.round(lapLen * 50) / 100;
  }
  const RS_BONUS_2017 = [15, 10, 8, 7, 6, 5, 4, 3, 2, 1];
  const CHASE_2026_RESET = [2100, 2075, 2065, 2060, 2055, 2050, 2045, 2040, 2035, 2030, 2025, 2020, 2015, 2010, 2005, 2000];

  // ---------- feed normalisation ----------
  function normalizeRace(meta, weekend, num, year) {
    const w = weekend.weekend_race[0];
    const stages = (w.stage_results || [])
      .slice()
      .sort((a, b) => a.stage_number - b.stage_number)
      .map((s) => s.results.map((r) => ({ id: r.driver_id, pos: r.finishing_position, pts: r.stage_points || 0 }))
        .sort((a, b) => a.pos - b.pos));
    const stagePts = new Map();
    stages.forEach((st) => st.forEach((r) => stagePts.set(r.id, (stagePts.get(r.id) || 0) + r.pts)));
    const isDuel = meta.race_type_id !== 1;
    const base = baseTableForYear(year);
    const results = w.results.map((r) => {
      const sp = stagePts.get(r.driver_id) || 0;
      const official = r.points_earned || 0;
      return {
        id: r.driver_id,
        name: r.driver_fullname.replace(/\s*\(.*?\)\s*/g, '').replace(/^[\s#*]+|[\s#*]+$/g, '').trim(),
        car: r.car_number, make: r.car_make, team: r.team_name,
        pos: r.finishing_position, start: r.starting_position,
        led: r.laps_led || 0, laps: r.laps_completed || 0, status: r.finishing_status,
        official, stagePts: sp,
        eligible: isDuel ? true : official > 0,
        fastLap: year >= 2025 && !isDuel && official - (base(r.finishing_position) + sp) === 1, // fastest-lap point began in 2025
      };
    }).sort((a, b) => a.pos - b.pos);
    const mostLed = results.reduce((m, r) => (r.led > (m ? m.led : 0) ? r : m), null);
    const laps = w.actual_laps || w.scheduled_laps || 1;
    const miles = w.actual_distance || w.scheduled_distance || 0;
    return {
      id: meta.race_id, num, isDuel, name: meta.race_name, track: meta.track_name, date: meta.race_date,
      miles, laps, lapLen: w.scheduled_laps ? w.scheduled_distance / w.scheduled_laps : miles / laps,
      results, stages, mostLedId: mostLed ? mostLed.id : null,
    };
  }

  // ---------- shared helpers ----------
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const stageWinners = (race) => race.stages.map((st) => st[0] && st[0].id).filter(Boolean);

  // Points one driver scores in one race under a scorer; ineligible drivers score nothing.
  function racePoints(race, scorer) {
    const out = new Map();
    race.results.forEach((r) => { if (r.eligible) out.set(r.id, scorer(r, race)); });
    return out;
  }
  function addInto(totals, pts) {
    const next = new Map(totals);
    pts.forEach((v, id) => next.set(id, (next.get(id) || 0) + v));
    return next;
  }
  function totalsOver(races, scorer) {
    return races.reduce((t, race) => addInto(t, racePoints(race, scorer)), new Map());
  }
  function seasonStats(races) {
    const s = new Map();
    races.forEach((race) => race.results.forEach((r) => {
      if (!r.eligible) return;
      const cur = s.get(r.id) || { wins: 0, t5: 0, t10: 0, starts: 0 };
      s.set(r.id, { wins: cur.wins + (r.pos === 1), t5: cur.t5 + (r.pos <= 5), t10: cur.t10 + (r.pos <= 10), starts: cur.starts + 1 });
    }));
    return s;
  }
  function byPoints(stats) {
    const z = { wins: 0, t5: 0, t10: 0 };
    return (a, b) => {
      const sa = stats.get(a.id) || z, sb = stats.get(b.id) || z;
      return b.pts - a.pts || sb.wins - sa.wins || sb.t5 - sa.t5 || sb.t10 - sa.t10;
    };
  }
  function ranked(totals, stats, extra) {
    return [...totals].map(([id, pts]) => ({ id, pts, ...(extra ? extra(id) : {}) })).sort(byPoints(stats));
  }

  // ---------- scorers ----------
  const S = {
    mileage: (r, race) => mileage(r.pos, race.miles),
    y1972: (r, race) => Math.max(0, 102 - 2 * r.pos) + r.laps * perLap(race.lapLen),
    y1973: (r, race) => (r.pos === 1 ? 125 : Math.max(0, 102 - 2 * r.pos)) + r.laps * perLap(race.lapLen),
    latford: (win) => (r, race) => latford(r.pos, win) + (r.led > 0 ? 5 : 0) + (race.mostLedId === r.id ? 5 : 0),
    y2011: (r, race) => t2011(r.pos) + (r.led > 0 ? 1 : 0) + (race.mostLedId === r.id ? 1 : 0),
    y2016: (r, race) => t2016(r.pos) + (r.led > 0 ? 1 : 0) + (race.mostLedId === r.id ? 1 : 0),
    y2017: (r, race) => (race.isDuel ? r.official : t2017(r.pos) + r.stagePts + (r.fastLap ? 1 : 0)),
    y2026: (r, race) => (race.isDuel ? r.official : t2026(r.pos) + r.stagePts + (r.fastLap ? 1 : 0)),
    awarded: (r) => r.official,   // the points NASCAR actually awarded, penalties included
  };

  // ---------- format runners ----------
  function fullSeason(ctx, scorer, withDuels) {
    const races = withDuels ? ctx.duels.concat(ctx.races) : ctx.races;
    const rows = ranked(totalsOver(races, scorer), ctx.stats);
    const done = ctx.races.length >= ctx.scheduled;
    rows.forEach((r, i) => { r.status = done && i === 0 ? 'champion' : 'season'; });
    return { rows, phase: done ? 'Final' : `Race ${ctx.races.length} of ${ctx.scheduled}` };
  }

  function regularSeasonOnly(ctx, scorer, withDuels, fieldSize) {
    const races = withDuels ? ctx.duels.concat(ctx.races) : ctx.races;
    const rows = ranked(totalsOver(races, scorer), ctx.stats);
    rows.forEach((r, i) => { r.status = i < fieldSize ? 'projected' : 'out'; });
    return { rows, phase: `Regular season, race ${ctx.races.length} of ${ctx.regLen}`, cut: fieldSize };
  }

  // Classic Chase: seed once after the regular season, no eliminations, most points wins.
  function classicChase(ctx, opt) {
    const regRaces = (opt.duels ? ctx.duels : []).concat(ctx.races.filter((r) => r.num <= ctx.regLen));
    const chaseRaces = ctx.races.filter((r) => r.num > ctx.regLen);
    if (ctx.races.length < ctx.regLen) return regularSeasonOnly(ctx, opt.scorer, opt.duels, opt.size);
    const rs = ranked(totalsOver(regRaces, opt.scorer), ctx.stats);
    const rsWins = seasonStats(regRaces.filter((r) => !r.isDuel));
    const field = opt.pick(rs, rsWins, ctx);
    const chasePts = totalsOver(chaseRaces, opt.scorer);
    const inField = new Map(field.map((id, i) => [id, i]));
    const rows = rs.map((r) => {
      const seed = inField.get(r.id);
      const base = seed === undefined ? r.pts : opt.reset(seed, r.id, rsWins);
      return { id: r.id, pts: base + (chasePts.get(r.id) || 0), seed: seed === undefined ? null : seed + 1, rsPts: r.pts };
    });
    const cmp = byPoints(ctx.stats);
    const done = ctx.races.length >= ctx.scheduled;
    const chase = rows.filter((r) => r.seed).sort(cmp);
    const rest = rows.filter((r) => !r.seed).sort(cmp);
    chase.forEach((r, i) => { r.status = done && i === 0 ? 'champion' : 'chase'; });
    rest.forEach((r) => { r.status = 'out'; });
    const left = ctx.scheduled - ctx.races.length;
    return { rows: chase.concat(rest), cut: chase.length, locked: true, phase: done ? 'Final' : `Chase race ${ctx.races.length - ctx.regLen} of ${ctx.scheduled - ctx.regLen}, ${left} to go` };
  }

  // Elimination playoffs (2014-2016 Chase Grid, 2017-2025 Playoffs).
  function elimination(ctx, opt) {
    if (ctx.races.length < ctx.regLen) return regularSeasonOnly(ctx, opt.scorer, opt.duels, 16);
    const regRaces = (opt.duels ? ctx.duels : []).concat(ctx.races.filter((r) => r.num <= ctx.regLen));
    const rs = ranked(totalsOver(regRaces, opt.scorer), ctx.stats);
    const rsStats = seasonStats(regRaces.filter((r) => !r.isDuel));
    const grid = opt.grid(rs, rsStats);
    const pp = new Map(grid.map((id) => [id, opt.seedBonus(id, rs, rsStats, regRaces)]));
    const raceN = (n) => ctx.races.find((r) => r.num === n);
    const R = ctx.regLen;
    const rounds = [[R + 1, R + 2, R + 3], [R + 4, R + 5, R + 6], [R + 7, R + 8, R + 9]];
    const resets = [2000, 3000, 4000];
    let alive = grid.slice();
    const elimOrder = new Map(); // id -> round eliminated (1-based)
    let roundPts = new Map(), phase = '', roundIdx = 0, clinched = new Set();
    for (; roundIdx < rounds.length; roundIdx++) {
      const run = rounds[roundIdx].map(raceN).filter(Boolean);
      const base = new Map(alive.map((id) => [id, resets[roundIdx] + (pp.get(id) || 0)]));
      roundPts = run.reduce((t, race) => addInto(t, racePoints(race, opt.scorer)), base);
      alive.forEach((id) => { if (!roundPts.has(id)) roundPts.set(id, base.get(id)); });
      clinched = new Set(run.map((race) => race.results[0].id).filter((id) => alive.includes(id)));
      if (opt.playoffPoints) run.forEach((race) => awardPlayoffPoints(race, alive, pp));
      const label = ['Round of 16', 'Round of 12', 'Round of 8'][roundIdx];
      if (run.length < 3) { phase = `${label}, race ${run.length} of 3`; break; }
      const order = alive.slice().sort((a, b) => byPoints(ctx.stats)({ id: a, pts: roundPts.get(a) }, { id: b, pts: roundPts.get(b) }));
      const keep = alive.length - 4;
      const adv = order.filter((id) => clinched.has(id)).concat(order.filter((id) => !clinched.has(id))).slice(0, keep);
      alive.filter((id) => !adv.includes(id)).forEach((id) => elimOrder.set(id, roundIdx + 1));
      alive = order.filter((id) => adv.includes(id));
      phase = `${label} complete`;
    }
    const finalRace = raceN(R + 10);
    // Fifth place and below: seed value at race 27 plus every point scored in races 27-36.
    const chaseRaces = ctx.races.filter((r) => r.num > R);
    const chaseTotals = totalsOver(chaseRaces, opt.scorer);
    const seedBase = new Map(grid.map((id) => [id, 2000 + opt.seedBonus(id, rs, rsStats, regRaces)]));
    const cmp = byPoints(ctx.stats);
    let top;
    if (roundIdx === 3) {
      const c4 = alive.slice();
      if (finalRace) {
        const fin = new Map(finalRace.results.map((r) => [r.id, r.pos]));
        const fp = racePoints(finalRace, opt.c4Scorer);
        top = c4.sort((a, b) => (fin.get(a) || 99) - (fin.get(b) || 99))
          .map((id, i) => ({ id, pts: 5000 + (fp.get(id) || 0), status: i === 0 ? 'champion' : 'final4' }));
        phase = 'Final';
      } else {
        top = c4.map((id) => ({ id, pts: 5000, status: 'final4' }));
        phase = 'Championship 4 set';
      }
    } else {
      top = alive.map((id) => ({ id, pts: roundPts.get(id), status: clinched.has(id) ? 'clinched' : 'alive' })).sort(cmp);
    }
    const out = [...elimOrder.keys()].map((id) => ({ id, pts: seedBase.get(id) + (chaseTotals.get(id) || 0), status: 'eliminated', elimRound: elimOrder.get(id) })).sort(cmp);
    const rest = rs.filter((r) => !grid.includes(r.id)).map((r) => ({ id: r.id, pts: r.pts + (chaseTotals.get(r.id) || 0), status: 'out' })).sort(cmp);
    const rows = top.concat(out, rest);
    rows.forEach((r) => { r.seed = grid.includes(r.id) ? grid.indexOf(r.id) + 1 : null; });
    const cut = top.length > 4 && roundIdx < 3 ? top.length - 4 : null;
    return { rows, phase, cut, aliveCount: top.length };
  }

  function awardPlayoffPoints(race, alive, pp) {
    const win = race.results[0] && race.results[0].id;
    if (alive.includes(win)) pp.set(win, (pp.get(win) || 0) + 5);
    stageWinners(race).forEach((id) => { if (alive.includes(id)) pp.set(id, (pp.get(id) || 0) + 1); });
  }

  // Winners first (most wins, then points), optional points-leader slot, then fill by points.
  function gridByWins(maxRank, leaderSlot) {
    return (rs, stats) => {
      const rankOf = new Map(rs.map((r, i) => [r.id, i + 1]));
      const winners = rs.filter((r) => (stats.get(r.id) || {}).wins > 0 && rankOf.get(r.id) <= maxRank)
        .sort((a, b) => stats.get(b.id).wins - stats.get(a.id).wins || rankOf.get(a.id) - rankOf.get(b.id))
        .map((r) => r.id);
      const leader = rs[0].id;
      let grid = winners.slice(0, leaderSlot && !winners.includes(leader) ? 15 : 16);
      if (leaderSlot && !grid.includes(leader)) grid.push(leader);
      for (const r of rs) { if (grid.length >= 16) break; if (!grid.includes(r.id)) grid.push(r.id); }
      return grid.sort((a, b) => rankOf.get(a) - rankOf.get(b));
    };
  }

  // ---------- the formats ----------
  const FORMATS = [
    { key: 'mileage', name: 'Mileage Era', years: '1968-1971', group: 'Classic',
      blurb: 'Points scaled by race length: under 250 miles pays 50 to win, 250-399 pays 100, 400+ pays 150. Even gaps, no bonuses, full season.',
      score: S.mileage, run: (c, sc) => fullSeason(c, sc || S.mileage) },
    { key: 'y1972', name: 'Modern Era Debut', years: '1972', group: 'Classic',
      blurb: '100 to win down by 2 per spot, plus lap points for every lap completed (0.25 per lap under 1 mile, about 0.5 per mile above).',
      score: S.y1972, run: (c, sc) => fullSeason(c, sc || S.y1972) },
    { key: 'y1973', name: 'Winner Bonus Era', years: '1973', group: 'Classic',
      blurb: 'The 1972 system with the win raised to 125. Lap points still reward distance completed.',
      score: S.y1973, run: (c, sc) => fullSeason(c, sc || S.y1973) },
    { key: 'latford', name: 'Winston Cup (Latford)', years: '1975-2003', group: 'Classic',
      blurb: 'Bob Latford\'s system: 175 to win, 170 for 2nd, sliding to 34 for 43rd. +5 for leading a lap, +5 for leading the most. Full 36-race season, no playoff.',
      score: S.latford(175), run: (c, sc) => fullSeason(c, sc || S.latford(175)) },
    { key: 'chase04', name: 'Chase for the Nextel Cup', years: '2004-2006', group: 'Chase',
      blurb: '180 to win, Latford scale. Top 10 after race 26 (plus anyone within 400 of the leader) reset to 5050, 5045 ... in 5 point steps.',
      score: S.latford(180),
      run: (c, sc) => classicChase(c, { scorer: sc || S.latford(180), size: 10,
        pick: (rs) => rs.filter((r, i) => i < 10 || rs[0].pts - r.pts <= 400).map((r) => r.id),
        reset: (i) => 5050 - 5 * i }) },
    { key: 'chase07', name: 'Chase for the Sprint Cup', years: '2007-2010', group: 'Chase',
      blurb: '185 to win, Latford scale. Top 12 after race 26 reset to 5000 plus 10 per regular-season win.',
      score: S.latford(185),
      run: (c, sc) => classicChase(c, { scorer: sc || S.latford(185), size: 12,
        pick: (rs) => rs.slice(0, 12).map((r) => r.id),
        reset: (i, id, w) => 5000 + 10 * ((w.get(id) || {}).wins || 0) }) },
    { key: 'chase11', name: 'Wild Card Chase', years: '2011-2013', group: 'Chase',
      blurb: '43 to win plus 3, 1 per spot after. +1 lead a lap, +1 most led. Top 10 plus 2 wild cards (most wins from 11th-20th). Reset 2000, +3 per win for the top 10.',
      score: S.y2011,
      run: (c, sc) => classicChase(c, { scorer: sc || S.y2011, size: 12,
        pick: (rs, w) => {
          const top = rs.slice(0, 10).map((r) => r.id);
          const wc = rs.slice(10, 20).filter((r) => (w.get(r.id) || {}).wins > 0)
            .sort((a, b) => w.get(b.id).wins - w.get(a.id).wins || b.pts - a.pts).slice(0, 2).map((r) => r.id);
          const fill = rs.slice(10, 20).map((r) => r.id).filter((id) => !wc.includes(id));
          return top.concat(wc, fill).slice(0, 12);
        },
        reset: (i, id, w) => 2000 + (i < 10 ? 3 * ((w.get(id) || {}).wins || 0) : 0) }) },
    { key: 'elim14', name: 'Chase Grid Eliminations', years: '2014-2016', group: 'Elimination',
      blurb: '40 to win plus 3, +1 lead a lap, +1 most led. 16 drivers, winners first. Three-race rounds cut 4 each, a win advances. Championship 4: best finish at the finale takes the title.',
      score: S.y2016,
      run: (c, sc) => elimination(c, { scorer: sc || S.y2016, c4Scorer: (r) => t2016(r.pos) - (r.pos === 1 ? 3 : 0),
        grid: gridByWins(30, true), seedBonus: (id, rs, st) => 3 * ((st.get(id) || {}).wins || 0), playoffPoints: false }) },
    { key: 'playoffs17', name: 'The Playoffs', years: '2017-2025', group: 'Elimination',
      blurb: '40 to win, 35 for 2nd. Stage points 10-1. Playoff points: 5 per win, 1 per stage win, 15-10-8-7-6-5-4-3-2-1 for the regular-season top 10. Win and you\'re in, cuts every 3 races, Championship 4 finale.',
      score: S.y2017,
      run: (c) => elimination(c, { scorer: S.y2017, duels: true, c4Scorer: (r) => t2017(r.pos),
        grid: gridByWins(99, false), playoffPoints: true,
        seedBonus: (id, rs, st, races) => {
          const idx = rs.findIndex((r) => r.id === id);
          const stageW = sum(races.filter((r) => !r.isDuel).map((r) => stageWinners(r).filter((x) => x === id).length));
          return 5 * ((st.get(id) || {}).wins || 0) + stageW + (RS_BONUS_2017[idx] || 0);
        } }) },
    { key: 'chase26', name: 'The Chase', years: '2026', group: 'Current',
      blurb: 'The current NASCAR format. 55 to win, stage points 10-1, fastest lap +1. Top 16 after race 26 reset to 2100, 2075, 2065 ... 2000. No eliminations, most points after 36 races wins.',
      score: S.y2026,
      run: (c) => classicChase(c, { scorer: S.y2026, duels: true, size: 16,
        pick: (rs, w, c) => (c.officialRsOrder || rs.map((r) => r.id)).slice(0, 16), reset: (i) => CHASE_2026_RESET[i] }) },
    { key: 'season26', name: 'Full Season, No Reset', years: '2026 points', group: 'Current',
      blurb: 'Every 2026 point (55 to win, stage points, fastest lap, Duels) added up across all 36 races with no Chase reset. The pure points champion.',
      score: S.y2026, run: (c) => fullSeason(c, S.y2026, true) },
  ];

  // Size of a race in each format's own points: the average winner haul and the biggest single-race haul.
  function raceScale(races, scorer) {
    const wins = [], hauls = [];
    races.forEach((race) => {
      const winner = race.results.find((r) => r.eligible);
      if (winner) wins.push(scorer(winner, race));
      race.results.forEach((r) => { if (r.eligible) hauls.push(scorer(r, race)); });
    });
    return { avgWin: wins.length ? sum(wins) / wins.length : 1, maxRace: hauls.length ? Math.max(...hauls) : 1 };
  }

  // The system each season actually used. 1974 paid by purse and cannot be recalculated.
  function officialFormat(year) {
    if (year >= 2026) return 'chase26';
    if (year >= 2017) return 'playoffs17';
    if (year >= 2014) return 'elim14';
    if (year >= 2011) return 'chase11';
    if (year >= 2007) return 'chase07';
    if (year >= 2004) return 'chase04';
    if (year >= 1975) return 'latford';
    if (year === 1974) return null;
    if (year === 1973) return 'y1973';
    if (year === 1972) return 'y1972';
    return 'mileage';
  }

  // ---------- season assembly ----------
  // roster: NASCAR's official points list (driver ids). Drivers off it score in no format.
  function applyRoster(race, roster) {
    if (!roster) return race;
    return { ...race, results: race.results.map((r) => (roster.has(r.id) ? r : { ...r, eligible: false })) };
  }
  // NASCAR's own order after the last regular-season race, which includes penalties the race results do not carry.
  function officialOrderAfter(weekend) {
    if (!weekend) return null;
    const rows = weekend.weekend_race[0].results.filter((r) => r.points_position > 0);
    return rows.length ? rows.sort((a, b) => a.points_position - b.points_position).map((r) => r.driver_id) : null;
  }
  // opts.awardedFor: format key to score with NASCAR's awarded per-race points instead of recomputing them.
  function buildSeason(raceList, weekends, year, roster, opts) {
    const points = raceList.filter((m) => m.race_type_id === 1).sort((a, b) => (a.date_scheduled || a.race_date).localeCompare(b.date_scheduled || b.race_date));
    const has = (m) => { const w = weekends[m.race_id]; return !!(w && w.weekend_race && w.weekend_race[0] && w.weekend_race[0].results && w.weekend_race[0].results.length); };
    const races = [], duels = [];
    points.forEach((m, i) => { if (has(m)) races.push(applyRoster(normalizeRace(m, weekends[m.race_id], i + 1, year), roster)); });
    raceList.filter((m) => m.race_type_id !== 1 && /duel/i.test(m.race_name) && has(m) && year >= 2017)
      .forEach((m) => duels.push(applyRoster(normalizeRace(m, weekends[m.race_id], 0, year), roster)));
    const regLen = Math.max(0, points.length - 10);
    const lastReg = points[regLen - 1];
    const drivers = new Map();
    duels.concat(races).forEach((race) => race.results.forEach((r) => {
      const prev = drivers.get(r.id) || {};
      drivers.set(r.id, { id: r.id, name: r.name, car: r.car || prev.car, make: r.make || prev.make, team: r.team || prev.team });
    }));
    const officialRsOrder = year >= 2026 && lastReg ? officialOrderAfter(weekends[lastReg.race_id]) : null;
    const ctx = { year, races, duels, scheduled: points.length, regLen, stats: seasonStats(races), drivers, officialRsOrder };
    const results = {};
    const remaining = Math.max(0, points.length - races.length);
    const awardedFor = opts && opts.awardedFor;
    FORMATS.forEach((f) => { results[f.key] = { ...f.run(ctx, f.key === awardedFor ? S.awarded : null), scale: raceScale(races, f.score), remaining, done: remaining === 0 }; });
    return { ctx, results };
  }

  const api = { FORMATS, buildSeason, normalizeRace, officialFormat, tables: { latford, t2011, t2016, t2017, t2026, mileage, perLap } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PointsEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
