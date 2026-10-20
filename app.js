// app.js v0.10.4: renders Cup Standings into the nascar.com-style template and keeps it live.
(function () {
  'use strict';
  const E = window.PointsEngine;
  const D = window.CupData;
  const G = window.PointsGrade;
  const CURRENT_YEAR = 2026;
  const FIRST_YEAR = 1968; // first season of equal-points racing; 1968-2016 load from data/history
  const LIVE_POLL_MS = 10 * 1000;       // during a race: live timing + live points
  const IDLE_POLL_MS = 60 * 1000;       // no race: watch for the green flag
  const OFFICIAL_TTL_MS = 10 * 60 * 1000;
  const MFR_LOGO = {
    Chevrolet: 'https://www.nascar.com/wp-content/uploads/sites/7/2025/03/04/Chevrolet_2025.png',
    Ford: 'https://www.nascar.com/wp-content/uploads/sites/7/2026/02/18/Ford-Racing-Logo-300-100.png',
    Toyota: 'https://www.nascar.com/wp-content/uploads/sites/7/2020/04/06/Toyota_new_wide-70x28-1.png',
  };
  const STATUS = { champion: 'Champion', final4: 'Championship 4', clinched: 'Clinched', alive: 'Alive', chase: 'In the Chase', projected: 'Projected', eliminated: 'Eliminated', out: '', season: '' };
  const ROUNDS = [16, 12, 8];
  const eliminatedIn = (round) => `Eliminated, Round of ${ROUNDS[round - 1]}`;
  const VIEWS = ['home', 'race', 'grade', 'matrix', 'format', 'rules', 'news'];
  // One name per page, used by the bottom bar, the page header and every link to the page.
  const PAGE = { home: 'Home', race: 'Next Race', grade: 'The Grade', matrix: 'All Formats', format: 'By Format', rules: 'Rules', news: 'Newsletter' };
  const STANDINGS_PAGES = ['grade', 'matrix', 'format'];
  // Every page has a real path made from its name: /home, /next-race, /the-grade, /all-formats,
  // /by-format/<format name>, /rules. "/" is Home too.
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const VIEW_OF_SLUG = Object.fromEntries(VIEWS.map((v) => [slug(PAGE[v]), v]));
  const PV = window.CupPreview;
  const LV = window.CupLive;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const longDate = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString('en-US', { month: 'long' })} ${ordinal(d.getDate())}, ${d.getFullYear()}`; };
  const shortDate = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const cleanName = E.cleanName;

  const state = { year: CURRENT_YEAR, view: 'home', fmt: 'chase26', off: null, offAt: 0, d: null, timer: null, lastRanks: new Map(), busy: false, signatures: new Set(), pv: null, photos: new Map() };

  // The season's own official format (engine.officialFormat): Playoffs 2017-2025, The Chase 2026, and so on back to 1968.
  // A format is always called by its name; the official one gets a separate tag, never a different name.
  const officialKey = () => E.officialFormat(state.d ? state.d.year : CURRENT_YEAR);
  const fname = (f) => f.name;
  const fmtLabel = (f) => `${esc(f.name)}${f.key === officialKey() ? '<span class="offtag">Official</span>' : ''}`;
  const formatBySlug = (s) => E.FORMATS.find((f) => slug(f.name) === s);
  function pathFor(view, fmtKey) {
    if (view !== 'format') return `/${slug(PAGE[view])}`;
    const f = E.FORMATS.find((x) => x.key === (fmtKey || state.fmt)) || E.FORMATS[0];
    return `/${slug(PAGE.format)}/${slug(f.name)}`;
  }
  const fmtHead = (f) => `<th class="fmt" data-fmt="${f.key}">${fmtLabel(f)}<small>${esc(f.years)}</small></th>`;
  const scoreLine = (g) => `Grade ${g.letter} / Score ${g.score.toFixed(1)}`;

  // ---------- small pieces ----------
  const drv = (id) => state.d.season.ctx.drivers.get(id) || { name: String(id), car: '', make: '' };
  function nameCell(id) {
    const parts = drv(id).name.split(' ');
    const split = parts.length > 2 && /\.$/.test(parts[1]) ? 2 : 1;
    return `<span class="name">${esc(parts.slice(0, split).join(' '))} <b>${esc(parts.slice(split).join(' '))}</b></span>`;
  }
  const badgeImg = (id) => {
    if (state.d && state.d.historic) return `<span class="txt">${esc(drv(id).car)}</span>`;
    const car = esc(drv(id).car);
    return `<img src="https://cf.nascar.com/data/images/carbadges/1/${car}.png" alt="${car}" loading="lazy" onerror="this.outerHTML='<span class=&quot;txt&quot;>${car}</span>'">`;
  };
  const badge = (id) => `<span class="badge">${badgeImg(id)}</span>`;
  function mfr(id) {
    const m = drv(id).make;
    return MFR_LOGO[m] ? `<span class="mfr"><img src="${MFR_LOGO[m]}" alt="${esc(m)}" loading="lazy" onerror="this.outerHTML='<span class=&quot;txt&quot;>${esc(m)}</span>'"></span>` : `<span class="mfr"><span class="txt">${esc(m)}</span></span>`;
  }
  function change(prev, now) {
    if (!prev || prev === now) return '';
    return prev > now ? `<span class="up">+${prev - now}</span>` : `<span class="dn">-${now - prev}</span>`;
  }
  const driverCols = (id) => `<td>${badge(id)}</td><td class="l">${nameCell(id)}</td><td>${mfr(id)}</td>`;
  // Grade tiers in the logo palette: A+ yellow, A black, B blue, C gray, D outline, F red outline.
  const gcls = (letter) => (letter === 'A+' ? 'g-top' : 'g-' + letter[0].toLowerCase());
  const gradeChip = (letter, title) => `<span class="grade ${gcls(letter)}"${title ? ` title="${esc(title)}"` : ''}><span>${esc(letter)}</span></span>`;
  const gradeText = (letter, text, title) => `<span class="lt ${gcls(letter)}" title="${esc(title)}">${esc(text)}</span>`;
  const rankMap = (rows) => new Map(rows.map((r, i) => [r.id, i + 1]));
  const tierClass = (r) => (r.tier === 'complete' ? 'elite' : r.tier === 'contender' ? 'contender' : '');
  const legend = () => `<div class="legend"><span><i class="edge" style="background:var(--edge-top5)"></i>Top 5 in every format</span><span><i class="edge" style="background:var(--edge-top10)"></i>Top 10 in every format</span>
    <span>Score is out of 100. A+ 90+, A 84+, A- 80+, B+ 75+, B 70+, B- 62+, C+ 55+, C 45+, C- 35+, D 20+, F below 20.</span></div>`;

  // Flash rows whose position changed since the last render of the same table.
  function moverClass(key, id, pos) {
    const prev = state.lastRanks.get(key);
    return prev && prev.has(id) && prev.get(id) !== pos ? ' mover' : '';
  }
  function remember(key, rows) { state.lastRanks.set(key, rankMap(rows)); }

  // ---------- chrome ----------
  function renderHead() {
    const { season, liveRace } = state.d;
    const page = PAGE[state.view];
    document.title = state.view === 'home' ? 'Cup Standings' : `${page} | Cup Standings`;
    $('season').textContent = `${state.d.year} NASCAR Cup Series`;
    $('title').textContent = page;
    $('updated').classList.toggle('on', !!liveRace);
    $('updatedTxt').textContent = liveRace
      ? `Live, updating every ${LIVE_POLL_MS / 1000}s`
      : `Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    const ctx = season.ctx;
    const last = ctx.races[ctx.races.length - 1];
    const standings = STANDINGS_PAGES.includes(state.view) && last;
    $('meta').textContent = !standings ? '' : liveRace
      ? `Live at ${liveRace.meta.track_name}, lap ${liveRace.live.lap_number} of ${liveRace.live.laps_in_race}. Race ${last.num} of ${ctx.scheduled}.`
      : `After race ${last.num} of ${ctx.scheduled}, ${last.track}${last.date ? `, ${longDate(last.date)}` : ''}.`;
    renderLive();
    document.querySelectorAll('.tabbar button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  }

  function renderLive() {
    const lr = state.d.liveRace;
    $('liveinfo').hidden = !lr;
    if (!lr) return;
    const order = lr.live.vehicles.slice().sort((a, b) => a.running_position - b.running_position).slice(0, 5)
      .map((v) => `P${v.running_position} ${esc(cleanName(v.driver.full_name))}`).join(' &nbsp; ');
    const stage = lr.live.stage && lr.live.stage.stage_num ? `Stage ${lr.live.stage.stage_num}` : '';
    $('liveinfo').innerHTML = `<span class="flag f${lr.live.flag_state}">${esc(lr.flag)}</span>
      <b>${esc(lr.meta.race_name)}</b><span>Lap ${lr.live.lap_number} of ${lr.live.laps_in_race}${stage ? ' / ' + stage : ''}</span>
      <span class="run">${order}</span>
      <span class="run">Every standings table counts this race at the current running order, with live stage points. ${lr.isFinal ? 'Unofficial until NASCAR posts the result.' : 'Arrows show movement since the green flag.'}</span>`;
  }

  // ---------- HOME ----------
  // Signature slot: add assets/signatures/<NASCAR driver id>.png and list the id in assets/signatures/index.json.
  function heroPanel(r) {
    const d = drv(r.id);
    const url = state.photos.get(r.id);
    const photo = url ? `<img class="photo" src="${esc(url)}" alt="${esc(d.name)}" fetchpriority="high">` : `<span class="nophoto">${esc(d.car)}</span>`;
    const name = `<span class="who">${esc(d.name)}</span>`;
    const sig = state.signatures.has(r.id) ? `<img class="sig" src="/assets/signatures/${r.id}.png" alt="${esc(d.name)}">` : name;
    return `<a class="panel" href="${pathFor('grade')}">${photo}<span class="num">${r.rank}</span>
      <span class="cap">${sig}<span class="stat">${esc(scoreLine(r))}</span></span></a>`;
  }
  function miniTable(rows, key) {
    return `<table class="mini"><tbody>${rows.slice(0, 5).map((r, i) => `<tr><td>${i + 1}</td><td>${badge(r.id)}</td><td class="l">${nameCell(r.id)}</td><td>${key(r)}</td></tr>`).join('')}</tbody></table>`;
  }
  function raceWidget() {
    const { list, liveRace, season } = state.d;
    const races = season.ctx.races.filter((r) => !liveRace || r.id !== liveRace.meta.race_id);
    const last = races[races.length - 1];
    const next = list.filter((m) => m.race_type_id === 1 && !m.winner_driver_id && (!liveRace || m.race_id !== liveRace.meta.race_id))
      .sort((a, b) => a.date_scheduled.localeCompare(b.date_scheduled))[0];
    const rows = [];
    if (liveRace) {
      const lead = liveRace.live.vehicles.find((v) => v.running_position === 1);
      rows.push(`<div class="row"><span><span class="flag">Live</span> <b>${esc(liveRace.meta.track_name)}</b></span><span>Lap ${liveRace.live.lap_number}/${liveRace.live.laps_in_race}</span></div>`);
      if (lead) rows.push(`<div class="row"><span>Leader</span><b>${esc(cleanName(lead.driver.full_name))}</b></div>`);
    }
    if (last) rows.push(`<div class="row"><span>Last race: <b>${esc(last.track)}</b></span><span>${esc(drv(last.results[0].id).name)}</span></div>`);
    if (next) rows.push(`<div class="row"><span>Next: <b>${esc(next.track_name)}</b></span><span>${esc(shortDate(next.date_scheduled))}</span></div>`);
    const title = liveRace ? 'Race Live Now' : next ? PAGE.race : 'Season Final';
    return `<div class="card widget race"><h3><span>${title}</span><small>Race ${races.length} of ${season.ctx.scheduled}</small></h3>${rows.join('')}</div>`;
  }
  const lastTrack = () => { const r = state.d.season.ctx.races; return r.length ? r[r.length - 1].track : 'the last race'; };
  function moverCard(title, list) {
    return `<div class="card widget"><h3><span>${esc(title)}</span></h3>${list.length ? `<table class="mini"><tbody>${list.map((m) => `<tr><td>${m.g.rank}</td><td class="chg">${change(m.g.rank + m.d, m.g.rank)}</td><td>${badge(m.g.id)}</td><td class="l">${nameCell(m.g.id)}</td><td>${gradeChip(m.g.letter)}</td><td>${m.g.score.toFixed(1)}</td></tr>`).join('')}</tbody></table>` : '<p class="lede">No change.</p>'}</div>`;
  }
  // Hero names stay on one line: shrink each until it fits its caption box.
  const MIN_NAME_PX = 14;
  function fitNames() {
    document.querySelectorAll('.panel .who').forEach((el) => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      const box = el.parentElement, pad = parseFloat(getComputedStyle(box).paddingLeft) * 2;
      // the 18deg slant leans the text about a third of its height past its box, so leave that much room too
      const room = () => box.clientWidth - pad - el.offsetHeight * 0.33 - 8;
      while (el.scrollWidth > room() && size > MIN_NAME_PX) { size -= 1; el.style.fontSize = `${size}px`; }
    });
  }
  window.addEventListener('resize', () => { if (state.view === 'home') fitNames(); });
  // Honorable mention: most 2nd places across the formats among drivers who lead none of them.
  function honorable(season) {
    const leaders = new Set(E.FORMATS.map((f) => (season.results[f.key].rows[0] || {}).id));
    const seconds = new Map();
    E.FORMATS.forEach((f) => { const r = season.results[f.key].rows[1]; if (r && !leaders.has(r.id)) seconds.set(r.id, (seconds.get(r.id) || 0) + 1); });
    const gradeRank = new Map(state.d.grades.map((g) => [g.id, g.rank]));
    let pick = [...seconds].sort((a, b) => b[1] - a[1] || (gradeRank.get(a[0]) || 99) - (gradeRank.get(b[0]) || 99))[0];
    const best = state.d.grades.find((g) => !leaders.has(g.id));
    if (!pick && best) pick = [best.id, 0];
    if (!pick) return '';
    return `<a class="card era honor" href="${pathFor('matrix')}"><p class="eyebrow">All formats</p><b>Honorable mention</b>
      <span class="era-lead">${badgeImg(pick[0])}${nameCell(pick[0])}</span><small>${pick[1] ? `2nd in ${pick[1]} of ${E.FORMATS.length} formats, leads none` : `Best without leading a format: ${esc(scoreLine(state.d.grades.find((g) => g.id === pick[0])))}`}</small></a>`;
  }
  function renderHome() {
    const { grades, season } = state.d;
    const offFmt = E.FORMATS.find((f) => f.key === officialKey());
    const chase = season.results[offFmt.key];
    const before = rankMap(state.d.before.grades);
    const moves = grades.map((g) => ({ g, d: (before.get(g.id) || g.rank) - g.rank })).filter((m) => m.d !== 0).sort((a, b) => b.d - a.d);
    $('home').innerHTML = `
      <div class="hero">
        <article class="card">
          <div class="art">${grades.slice(0, 3).map(heroPanel).join('')}</div>
          <div class="copy"><p class="eyebrow">${state.d.year} NASCAR Cup Series / The Grade</p>
            <h2>Every format. One champion.</h2>
            <p>Cup Standings replays the live ${state.d.year} season under all ${E.FORMATS.length} championship formats NASCAR has used since 1968, from the mileage era and Winston Cup through the Playoffs to today's Chase, then grades every driver across all of them.</p></div>
        </article>
        <div class="side">
          ${raceWidget()}
          <div class="card widget"><h3><span>${fmtLabel(offFmt)}</span><small>${esc(chase.phase)}</small></h3>${miniTable(chase.rows, (r) => num(r.pts))}<a class="pill" href="${pathFor('format', offFmt.key)}">${PAGE.format}</a></div>
        </div>
      </div>
      ${state.d.list.some((m) => m.race_type_id === 1 && !m.winner_driver_id) ? `<h2 class="sub">${PAGE.race}</h2>${previewStrip()}` : ''}
      <h2 class="sub">Who leads every format</h2>
      <p class="lede">The leader of each championship format right now. Select one to open it in ${PAGE.format}.</p>
      <div class="eras">${E.FORMATS.map((f) => { const res = season.results[f.key]; const lead = res.rows[0]; return lead ? `<a class="card era" href="${pathFor('format', f.key)}"><p class="eyebrow">${esc(f.years)}</p><b>${fmtLabel(f)}</b>
        <span class="era-lead">${badgeImg(lead.id)}${nameCell(lead.id)}</span><small>${esc(res.phase)}</small></a>` : ''; }).join('')}${honorable(season)}</div>
      <h2 class="sub">${PAGE.grade} movers</h2>
      <p class="lede">Biggest changes in ${PAGE.grade} since ${esc(lastTrack())}.</p>
      <div class="movers">${moverCard('Climbing', moves.filter((m) => m.d > 0).slice(0, 3))}${moverCard('Falling', moves.filter((m) => m.d < 0).sort((a, b) => a.d - b.d).slice(0, 3))}</div>
      <h2 class="sub">${PAGE.grade} top 10</h2>
      <div class="card widget" style="margin-top:16px"><table class="mini"><thead><tr><th>Pos</th><th></th><th>No.</th><th class="l">Driver</th><th>Grade</th><th>Score</th><th>Best</th><th>Worst</th></tr></thead><tbody>${grades.slice(0, 10).map((g) => `<tr><td>${g.rank}</td><td class="chg">${change(before.get(g.id), g.rank)}</td><td>${badge(g.id)}</td><td class="l">${nameCell(g.id)}</td><td>${gradeChip(g.letter)}</td><td>${g.score.toFixed(1)}</td><td>${g.best}</td><td>${g.worst}</td></tr>`).join('')}</tbody></table>
        <a class="pill" href="${pathFor('grade')}">${PAGE.grade}</a></div>`;
  }

  // ---------- NEXT RACE ----------
  const PHASES = [['s1', 'Stage 1'], ['s2', 'Stage 2'], ['s3', 'Final stage'], ['late', `Last ${PV.LATE_LAPS} laps`]];
  const pct = (x) => `${Math.round(x * 100)}%`;
  const raceWhen = (m) => `${longDate(m.date_scheduled)}, ${new Date(m.date_scheduled).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const photoOf = (id) => state.photos.get(id) || '';
  function watchReasons(w, pv) {
    const chase = E.FORMATS.find((f) => f.key === 'chase26');
    const out = [`${ordinal(w.chasePos)} in ${fname(chase)}, ${w.chaseGap} points behind with ${w.remaining} races left (${w.chaseWins.toFixed(1)} race wins behind).`,
      `Alive in ${w.alive} of ${E.FORMATS.length} formats, needing ${w.need.toFixed(2)} race wins per race left on average.`];
    w.notes.forEach((n) => out.push(`Below the cut in ${fname(n.fmt)} by ${n.points} points.`));
    const f = pv.form.find((x) => x.id === w.id);
    if (f) out.push(`At ${pv.next.track_name}: ${f.avg.toFixed(1)} average finish in ${f.starts} starts, ${f.wins} win${f.wins === 1 ? '' : 's'}.`);
    return out;
  }
  function previewStrip() {
    const pv = state.pv;
    if (!pv) return '<div class="card widget">Loading the race preview.</div>';
    const w = pv.watch[0];
    return `<div class="card preview-strip"><div class="layout">${pv.layout ? `<img class="map" src="${esc(pv.layout)}" alt="${esc(pv.next.track_name)} layout">` : ''}${pv.track && pv.track.track_logo ? `<img class="logo-badge" src="${esc(pv.track.track_logo)}" alt="${esc(pv.next.track_name)}">` : ''}</div>
      <div class="body"><p class="eyebrow">${esc(raceWhen(pv.next))}</p><h3>${esc(pv.next.race_name)}</h3>
      <p>${esc(pv.next.track_name)}${pv.track ? `, ${pv.track.length} mi ${esc(pv.track.track_type).toLowerCase()}` : ''}. ${pv.trends.races ? `Last ${pv.trends.races} races here averaged ${pv.trends.cautions.toFixed(1)} cautions and ${pv.trends.leadChanges.toFixed(0)} lead changes.` : ''}</p>
      ${w ? `<p><b>Driver to watch: ${esc(drv(w.id).name)}.</b> ${esc(watchReasons(w, pv)[0])}</p>` : ''}
      <a class="pill" href="${pathFor('race')}">${PAGE.race}</a></div></div>`;
  }
  function renderRace() {
    const pv = state.pv;
    if (!pv) { $('race').innerHTML = `<div class="card widget">${state.year === CURRENT_YEAR ? 'Loading the race preview.' : 'This season is complete. Switch to the current season for the next race preview.'}</div>`; return; }
    const { next, track, history, trends: t, timing, form, watch } = pv;
    const w = watch[0];
    const stages = [next.stage_1_laps, next.stage_2_laps, next.stage_3_laps].filter(Boolean).join(' / ');
    const facts = [[`${next.scheduled_laps}`, 'Laps'], [`${next.scheduled_distance} mi`, 'Distance'], [stages || 'TBA', 'Stage laps'],
      [track ? `${track.length} mi` : '', 'Track length'], [track ? track.track_type : '', 'Track type'], [track ? `${track.track_num_turns}` : '', 'Turns']];
    const topPhase = PHASES.reduce((a, b) => (timing.cautions[b[0]] > timing.cautions[a[0]] ? b : a));
    const bars = (shares) => PHASES.map(([k, label]) => `<div class="phase"><span>${esc(label)}</span><span class="bar"><i style="width:${pct(shares[k])}"></i></span><em>${pct(shares[k])}</em></div>`).join('');
    const gradeOf = new Map(state.d.grades.map((g) => [g.id, g]));
    $('race').innerHTML = `
      <div class="race-top">
        <article class="card track-card">
          <div class="layout">${track ? `${pv.layout ? `<img class="map" src="${esc(pv.layout)}" alt="${esc(next.track_name)} layout">` : '<span class="map"></span>'}<img class="logo-badge" src="${esc(track.track_logo)}" alt="${esc(next.track_name)}">` : ''}</div>
          <div class="copy"><p class="eyebrow">${esc(raceWhen(next))}${next.television_broadcaster ? ` / ${esc(next.television_broadcaster)}` : ''}</p>
            <h2>${esc(next.race_name)}</h2><p>${esc(next.track_name)}${track ? `, ${esc(track.city)}, ${esc(track.state)}. Banking: ${esc(track.track_banking)}.` : ''}</p></div>
          <div class="facts">${facts.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
        </article>
        ${w ? `<article class="card watch">${photoOf(w.id) ? `<img class="photo" src="${esc(photoOf(w.id))}" alt="${esc(drv(w.id).name)}">` : '<span class="photo"></span>'}
          <div class="body"><p class="eyebrow">Driver to watch</p><span class="who">${esc(drv(w.id).name)}</span>
            <div>${esc(scoreLine(w.grade))}</div>
            <ul>${watchReasons(w, pv).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
            ${watch.length > 1 ? `<p class="alsowatch">Also under pressure: ${watch.slice(1, 4).map((x) => esc(drv(x.id).name)).join(', ')}.</p>` : ''}</div></article>` : '<article class="card widget">No Grade contender needs to gain ground right now.</article>'}
      </div>
      <h2 class="sub">${esc(next.track_name)} trends</h2>
      <p class="lede">From the last ${t.races} Cup races here.</p>
      <div class="stats">${[[t.cautions.toFixed(1), 'Cautions per race'], [t.leadChanges.toFixed(0), 'Lead changes per race'], [t.leaders.toFixed(0), 'Leaders per race'],
        [`${t.deepWins} of ${t.races}`, 'Winners who started outside the top 10'], [t.winnerStart.toFixed(1), 'Average winner start'], [`${t.closeFinishes} of ${t.races}`, 'Finishes under 0.1 sec'],
        [`${t.cautionFinishes} of ${t.races}`, 'Races ended under caution'], [t.cautionLaps.toFixed(0), 'Caution laps per race']].map(([v, l]) => `<div class="card stat-tile"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
      <div class="race-grid">
        <div class="card widget"><h3><span>When the action comes</span><small>${timing.cautionCount} incidents, ${timing.changeCount} lead changes</small></h3>
          <p class="callout">The biggest share of wrecks and incidents here comes in <b>${esc(topPhase[1].toLowerCase())}</b> (${pct(timing.cautions[topPhase[0]])}). ${pct(timing.cautions.late)} come in the last ${PV.LATE_LAPS} laps.</p>
          <p class="eyebrow" style="margin-top:12px">Wrecks and incidents</p>${bars(timing.cautions)}
          <p class="eyebrow" style="margin-top:12px">Lead changes</p>${bars(timing.leads)}</div>
        <div class="card widget"><h3><span>Recent winners</span><small>${esc(next.track_name)}</small></h3>
          <table class="mini"><tbody>${history.map((h) => { const win = PV.winnerOf(h.race); return win ? `<tr><td>${h.meta.season}</td><td class="l">${esc(h.race.race_name)}</td><td class="l">${esc(cleanName(win.driver_fullname))}</td><td>Started ${win.starting_position}</td></tr>` : ''; }).join('')}</tbody></table></div>
      </div>
      <h2 class="sub">Driver form at ${esc(next.track_name)}</h2>
      <p class="lede">Every current driver with ${PV.MIN_TRACK_STARTS} or more starts in the last ${t.races} races here, best average finish first.</p>
      <div class="card" style="margin-top:16px"><div class="tbl" style="margin:0"><table><thead><tr><th>Pos</th><th>No.</th><th class="l">Driver</th><th>Starts</th><th>Wins</th><th>Top 5s</th><th>Top 10s</th><th>Avg Finish</th><th>Laps Led</th><th>Grade</th></tr></thead>
        <tbody>${form.slice(0, 15).map((f, i) => `<tr><td>${i + 1}</td><td>${badge(f.id)}</td><td class="l">${nameCell(f.id)}</td><td>${f.starts}</td><td>${f.wins}</td><td>${f.t5}</td><td>${f.t10}</td><td>${f.avg.toFixed(1)}</td><td>${f.led}</td><td>${gradeOf.has(f.id) ? gradeChip(gradeOf.get(f.id).letter) : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  // ---------- THE GRADE ----------
  function renderGrade() {
    const g = state.d.grades;
    const prev = rankMap(state.d.before.grades);
    const head = `<tr><th>Pos</th><th></th><th>No.</th><th class="l">Driver</th><th>Mfr</th><th>Grade</th><th>Score</th><th>Position</th><th>Margin</th><th>Title</th><th>Best</th><th>Worst</th>${E.FORMATS.map(fmtHead).join('')}</tr>`;
    const body = g.map((r) => `<tr class="${tierClass(r)}${moverClass('grade', r.id, r.rank)}">
      <td>${r.rank}</td><td class="chg">${change(prev.get(r.id), r.rank)}</td>${driverCols(r.id)}
      <td>${gradeChip(r.letter)}</td><td class="gpa">${r.score.toFixed(1)}</td><td>${r.position.toFixed(0)}</td><td>${r.margin.toFixed(0)}</td><td>${r.title.toFixed(0)}</td><td>${r.best}</td><td>${r.worst}</td>
      ${E.FORMATS.map((f) => `<td>${gradeText(r.per[f.key].letter, r.per[f.key].letter, formatTip(f, r.per[f.key]))}</td>`).join('')}</tr>`).join('');
    $('tbl').innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
    remember('grade', g);
    $('notes').innerHTML = `${legend()}<h2 class="sub">About The Grade</h2>
      <p>The Grade is a new championship format. Every driver is scored under all ${E.FORMATS.length} championship formats NASCAR has used since 1968, and every format counts the same. In each format a driver earns three equal scores out of 100:</p>
      <p><b>Position</b>: where the driver ranks in that format. <b>Margin</b>: how far behind that format's leader, counted in race wins in that format's own points; 10 race wins behind scores 0. <b>Title</b>: what that format's rules say about the championship: champion, still alive, eliminated in which round, or out of the field.</p>
      <p>The three average into a format score, and the ${E.FORMATS.length} format scores average into the final score. Hover any format letter for the detail.</p>`;
    $('extra').innerHTML = '';
  }

  // Title status names, shared by the format tooltips, By Format's Status column and Rules.
  const OUT_OF_REACH = 'Out of reach';
  const OUT = 'Out';
  const TITLE_WORD = (p) => (p.title >= 100 ? STATUS.champion : p.title >= 85 ? STATUS.clinched : p.title >= 75 ? STATUS.alive : p.title >= 40 ? STATUS.eliminated : p.title > 0 ? OUT_OF_REACH : OUT);
  const formatTip = (f, p) => `${fname(f)}: ${ordinal(p.rank)}, ${p.gapWins == null ? 'not scored' : p.gapWins.toFixed(1) + ' race wins behind'}, ${TITLE_WORD(p)}. Grade ${p.letter} / Score ${p.score.toFixed(0)}`;

  // ---------- ALL FORMATS ----------
  function renderMatrix() {
    const g = state.d.grades;
    const prev = rankMap(state.d.before.grades);
    const head = `<tr><th>Pos</th><th></th><th>No.</th><th class="l">Driver</th><th>Mfr</th><th>Grade</th>${E.FORMATS.map(fmtHead).join('')}</tr>`;
    const body = g.map((r) => `<tr class="${tierClass(r)}${moverClass('matrix', r.id, r.rank)}">
      <td>${r.rank}</td><td class="chg">${change(prev.get(r.id), r.rank)}</td>${driverCols(r.id)}<td>${gradeChip(r.letter)}</td>
      ${E.FORMATS.map((f) => { const p = r.per[f.key]; return `<td>${gradeText(p.letter, String(p.rank), formatTip(f, p))}</td>`; }).join('')}</tr>`).join('');
    $('tbl').innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
    remember('matrix', g);
    $('notes').innerHTML = `${legend()}<h2 class="sub">About ${PAGE.matrix}</h2>
      <p>Every column is a full championship standings, replayed race by race on this season's real results under that format's rules. The number is the driver's position in that format. Select a column to open it in ${PAGE.format}.</p>`;
    $('extra').innerHTML = '';
  }

  // ---------- BY FORMAT ----------
  function renderFormat() {
    const f = E.FORMATS.find((x) => x.key === state.fmt) || E.FORMATS[0];
    const res = state.d.season.results[f.key];
    const prev = rankMap(state.d.before.season.results[f.key].rows);
    $('subtabs').innerHTML = E.FORMATS.map((x) => `<li><button type="button" data-fmt="${x.key}" aria-pressed="${x.key === f.key}"><small>${esc(x.years)}</small><b>${fmtLabel(x)}</b></button></li>`).join('');
    const active = $('subtabs').querySelector('[aria-pressed="true"]');
    if (active) $('subtabs').scrollLeft = active.offsetLeft - ($('subtabs').clientWidth - active.offsetWidth) / 2;
    const v = f.key === officialKey() ? state.d.verify : null;
    const showCut = res.cut && !res.locked;
    const leader = res.rows[0];
    const cutPts = showCut ? res.rows[res.cut - 1].pts : null;
    const nextPts = showCut && res.rows[res.cut] ? res.rows[res.cut].pts : null;
    const inPlay = (r) => ['alive', 'clinched', 'chase', 'projected'].includes(r.status);
    const stats = state.d.season.ctx.stats;
    const head = `<tr><th>Pos</th><th></th><th>No.</th><th class="l">Driver</th><th>Mfr</th><th>Points</th><th>Behind</th>${showCut ? '<th>To Cut</th>' : ''}<th>Seed</th><th>Wins</th><th>Top 5s</th><th>Top 10s</th><th class="l">Status</th></tr>`;
    const body = res.rows.map((r, i) => {
      const s = stats.get(r.id) || { wins: 0, t5: 0, t10: 0 };
      const toCut = showCut && inPlay(r) && nextPts != null ? (i < res.cut ? r.pts - nextPts : r.pts - cutPts) : null;
      const label = r.status === 'eliminated' ? eliminatedIn(r.elimRound) : STATUS[r.status];
      return `<tr class="${res.cut && i + 1 === res.cut ? 'cut' : ''}${moverClass('f-' + f.key, r.id, i + 1)}"><td>${i + 1}</td><td class="chg">${change(prev.get(r.id), i + 1)}</td>${driverCols(r.id)}
        <td>${num(r.pts)}</td><td>${i ? num(Math.round((r.pts - leader.pts) * 10) / 10) : 0}</td>
        ${showCut ? `<td>${toCut == null ? '' : (toCut > 0 ? '+' : '') + num(toCut)}</td>` : ''}
        <td>${r.seed || ''}</td><td>${s.wins}</td><td>${s.t5}</td><td>${s.t10}</td>
        <td class="l">${label ? `<span class="status ${r.status}">${esc(label)}</span>` : ''}</td></tr>`;
    }).join('');
    $('tbl').innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
    remember('f-' + f.key, res.rows);
    $('notes').innerHTML = `<h2 class="sub">${fmtLabel(f)} (${esc(f.years)})</h2><p>${esc(f.blurb)}</p>
      <p>Status: ${esc(res.phase)}.${v ? ` <span class="${v.match === v.total ? 'ok' : 'bad'}">Matches NASCAR's official standings for ${v.match} of ${v.total} drivers.</span>` : ''}</p>`;
    $('extra').innerHTML = '';
  }

  // ---------- RULES ----------
  function renderRules() {
    const v = state.d.verify;
    const ranks = [[1, 1], [2, 3], [4, 5], [6, 8], [9, 12], [13, 16], [17, 20], [21, 24], [25, 28], [29, 32], [33, null]];
    const finish = (a, b) => (b == null ? `${ordinal(a)} and lower` : a === b ? ordinal(a) : `${ordinal(a)} to ${ordinal(b)}`);
    // Same status names as By Format's Status column and the format tooltips.
    const titles = [[STATUS.champion, G.STATUS_SCORE.champion], [STATUS.final4, G.STATUS_SCORE.final4], [`${STATUS.clinched}: won into the next round`, G.STATUS_SCORE.clinched],
      [`${STATUS.alive}: still in the title fight`, G.STATUS_SCORE.alive], [eliminatedIn(3), G.ELIMINATED_SCORE[3]], ['Season complete, in the field', G.FIELD_FINISH],
      [eliminatedIn(2), G.ELIMINATED_SCORE[2]], [eliminatedIn(1), G.ELIMINATED_SCORE[1]], [`${OUT_OF_REACH}: in the field, cannot win`, G.OUT_OF_REACH], [`${OUT}: missed the field`, 0]];
    $('tbl').innerHTML = `<table><thead><tr><th class="l">Place in a format</th><th>Position</th><th class="l">Title status in a format</th><th>Title</th></tr></thead><tbody>${ranks.map(([a, b], i) => `<tr><td class="l">${finish(a, b)}</td><td>${G.positionScore(a).toFixed(0)}</td><td class="l">${titles[i] ? esc(titles[i][0]) : ''}</td><td>${titles[i] ? titles[i][1] : ''}</td></tr>`).join('')}</tbody></table>
      <table style="margin-top:24px"><thead><tr><th class="l">Behind the format leader</th><th>Margin</th><th class="l">Score</th><th>Grade</th></tr></thead><tbody>${[0, 1, 2, 4, 6, 8, 10].map((w, i) => { const l = G.LETTERS[i]; return `<tr><td class="l">${w === 0 ? 'Leader' : `${w} race wins behind`}</td><td>${G.marginScore(w).toFixed(0)}</td><td class="l">${l ? `${l[0] === -Infinity ? 'Below 20' : l[0] + ' and up'}` : ''}</td><td>${l ? gradeChip(l[1]) : ''}</td></tr>`; }).join('')}${G.LETTERS.slice(7).map((l) => `<tr><td class="l"></td><td></td><td class="l">${l[0] === -Infinity ? 'Below 20' : l[0] + ' and up'}</td><td>${gradeChip(l[1])}</td></tr>`).join('')}</tbody></table>`;
    $('notes').innerHTML = `<h2 class="sub">How it is calculated</h2>
      <p>Every format is replayed from NASCAR's race-by-race results: finishing order, laps led, laps completed, stage finishes and the points NASCAR awarded. During a race, the live running order and NASCAR's live stage points count as if the race ended now.</p>
      <p>${v ? `The current format is checked against NASCAR's official standings on every load: ${v.match} of ${v.total} drivers match. ` : ''}The 2017-2025 engine reproduces NASCAR's 2025 playoff field and all three cuts. NASCAR's official order after race 26 seeds The Chase, so penalties count there; historical formats use on-track results. Exact ties break on wins, top 5s, then top 10s.</p>`;
    $('extra').innerHTML = `<h2 class="sub">The ${E.FORMATS.length} championship formats</h2><div class="rules">${E.FORMATS.map((f) => `<article><h3><small>${esc(f.years)}</small>${fmtLabel(f)}</h3><p>${esc(f.blurb)}</p></article>`).join('')}</div>`;
  }

  // ---------- routing ----------
  function render() {
    if (!state.d) return;
    const home = state.view === 'home';
    const race = state.view === 'race';
    const news = state.view === 'news';
    document.body.classList.toggle('is-home', home);
    document.body.classList.toggle('is-race', race);
    document.body.classList.toggle('is-news', news);
    $('race').hidden = !race;
    $('news').hidden = !news;
    $('home').hidden = !home;
    $('pagehead').hidden = home;
    const lr = race && state.d.liveRace;
    $('live').hidden = !lr;
    if (lr) LV.update($('live'), lr, state.pv && state.pv.track ? state.pv.track.track_image : null);
    $('standings').hidden = home || race || news;
    renderHead();
    $('subtabs').hidden = state.view !== 'format';
    ({ home: () => { renderHome(); fitNames(); document.fonts.ready.then(fitNames); }, race: renderRace, grade: renderGrade, matrix: renderMatrix, format: renderFormat, rules: renderRules, news: () => window.CupNews.page($('news')) })[state.view]();
  }
  function go(view, fmt) {
    const path = pathFor(view, fmt);
    if (path !== location.pathname) history.pushState(null, '', path);
    readRoute();
  }
  function readRoute() {
    // links from before the clean paths (#grade, #format/chase26) land on their path
    if (location.hash.length > 1) {
      const [v, k] = location.hash.slice(1).split('/');
      const old = VIEWS.includes(v) ? pathFor(v, E.FORMATS.some((f) => f.key === k) ? k : undefined) : '/';
      history.replaceState(null, '', old);
    }
    const [page, sub] = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const nextView = VIEW_OF_SLUG[page] || 'home';
    const fmt = nextView === 'format' && formatBySlug(sub);
    if (fmt) state.fmt = fmt.key;
    if (nextView === 'format' && location.pathname !== pathFor('format')) history.replaceState(null, '', pathFor('format'));
    if (nextView !== state.view) window.scrollTo({ top: 0 });
    state.view = nextView;
    render();
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/"]');
    if (a && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();                               // page links switch pages without a reload
      if (a.getAttribute('href') !== location.pathname) history.pushState(null, '', a.getAttribute('href'));
      readRoute();
      return;
    }
    const t = e.target.closest('button[data-view], button[data-fmt], th[data-fmt]');
    if (!t) return;
    if (t.dataset.view) go(t.dataset.view);
    else go('format', t.dataset.fmt);
  });

  // ---------- driver photos ----------
  function ensurePhotos() {
    const ids = new Set(state.d.grades.slice(0, 3).map((g) => g.id));
    if (state.pv && state.pv.watch[0]) ids.add(state.pv.watch[0].id);
    const missing = [...ids].filter((id) => !state.photos.has(id));
    if (!missing.length) return;
    missing.forEach((id) => state.photos.set(id, null));
    Promise.all(missing.map((id) => D.photoFor(id, drv(id).name).then((url) => state.photos.set(id, url))))
      .then(() => { if (state.view === 'home' || state.view === 'race') render(); })
      .catch((err) => console.error('Driver photo lookup failed', err));
  }

  // ---------- live loop ----------
  async function tick(forceOfficial) {
    if (state.busy) return;
    state.busy = true;
    clearTimeout(state.timer);
    let live = false;
    try {
      const isCurrent = state.year === CURRENT_YEAR;
      if (forceOfficial || !state.off || Date.now() - state.offAt > OFFICIAL_TTL_MS) {
        state.off = await D.loadOfficial(state.year, isCurrent);
        state.offAt = Date.now();
      }
      const lr = isCurrent ? await D.loadLive(state.off) : null;
      const raceJustEnded = state.d && state.d.liveRace && !lr;
      if (raceJustEnded) { state.off = await D.loadOfficial(state.year, isCurrent); state.offAt = Date.now(); }
      state.d = D.build(state.off, lr);
      live = !!lr;
      render();
      ensurePhotos();
      PV.load(state.off, lr, state.d.season.results, state.d.grades, E.FORMATS)
        .then((pv) => {
          state.pv = pv ? { ...pv, layout: pv.track ? pv.track.track_image : null } : pv;   // NASCAR's own layout image
          ensurePhotos();
          if (state.view === 'race' || state.view === 'home') render();
        })
        .catch((err) => console.error('Race preview unavailable', err));
    } catch (err) {
      console.error('Cup Standings load failed', err);
      $('updatedTxt').innerHTML = `<span class="err">NASCAR feed unavailable: ${esc(err.message)}. Retrying.</span>`;
    } finally {
      state.busy = false;
      state.timer = setTimeout(() => tick(false), live ? LIVE_POLL_MS : IDLE_POLL_MS);
    }
  }

  for (let y = CURRENT_YEAR; y >= FIRST_YEAR; y--) $('year').insertAdjacentHTML('beforeend', `<option value="${y}">${y} Season</option>`);
  $('year').addEventListener('change', (e) => {
    state.year = Number(e.target.value); state.fmt = state.year < 2026 ? 'playoffs17' : 'chase26';
    if (state.view === 'format') history.replaceState(null, '', pathFor('format'));
    state.off = null; state.d = null; state.pv = null; state.lastRanks.clear(); tick(true);
  });
  window.addEventListener('popstate', readRoute);
  fetch('/assets/signatures/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => [])
    .then((ids) => { state.signatures = new Set(ids); render(); });
  readRoute();
  tick(true);
})();
