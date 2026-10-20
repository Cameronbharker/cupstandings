// live.js v0.1.0: the live race view for Cup Standings. Cars on the real track map, the full running
// order with gaps and lap times, pit road, flags and NASCAR's race notes. All from NASCAR's public live feeds.
(function (root) {
  'use strict';
  const FLAG = (root.CupData && root.CupData.FLAGS) || {};   // one set of flag names, shared with data.js
  const RED = 3, CHECKERED = 9;
  const HOLD_AT = 0.9;          // past 90% of its last lap time without crossing the line, a car slows toward it
  const MAX_F = 0.999;          // and stops just short of it until the next crossing comes in
  const PIT_STOPS_SHOWN = 12;
  const NOTES_SHOWN = 12;
  const TYPE = { FOUR_WHEEL_CHANGE: '4 tires', TWO_WHEEL_CHANGE_RIGHT: 'Right side', TWO_WHEEL_CHANGE_LEFT: 'Left side', OTHER: 'Fuel only' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const name = (s) => String(s || '').replace(/\s*\(.*?\)/g, '').replace(/^[\s#*]+/, '');
  const secs = (t) => (t > 0 ? t.toFixed(3) : '');
  const lapsLed = (v) => (v.laps_led || []).reduce((s, l) => s + (l.end_lap - l.start_lap + 1), 0);

  // ---------- where each car is ----------
  // NASCAR's live feed stamps each car's last start/finish crossing (vehicle_elapsed_time, race seconds).
  // Time since that crossing over the car's last lap time is how far round the lap it is.
  function lapFraction(v, now) {
    const lap = v.last_lap_time;
    if (!(lap > 0)) return 0;
    const t = Math.max(0, now - v.vehicle_elapsed_time) / lap;
    if (t <= HOLD_AT) return t;
    return Math.min(MAX_F, HOLD_AT + (1 - HOLD_AT) * (1 - Math.exp(-(t - HOLD_AT) / 0.3)));
  }
  const inPits = (v) => (v.pit_stops || []).some((p) => p.pit_in_elapsed_time > 0 && !(p.pit_out_elapsed_time > 0));
  function positions(vehicles, now) {
    return vehicles.map((v) => ({
      car: v.vehicle_number, pos: v.running_position,
      where: !v.is_on_track ? 'out' : inPits(v) ? 'pit' : 'track',
      f: lapFraction(v, now),
    }));
  }
  // Race clock at the moment the feed was read: never behind the latest crossing it reports.
  const feedClock = (live) => Math.max(live.elapsed_time || 0, ...live.vehicles.map((v) => v.vehicle_elapsed_time || 0));

  // ---------- the track ----------
  // NASCAR's layout image for the track, and under it the lap: start/finish on the left, the lap running
  // to the right, every car on track placed at its share of the lap. Cars on pit road sit on their own row.
  const state = { box: null, cars: new Map(), lr: null, clock0: 0, at: 0, raf: 0 };

  function mountTrack(box, layout) {
    if (state.box === box && box.querySelector('.lap-bar')) {
      const img = box.querySelector('.live-layout');
      if (img && layout && img.getAttribute('src') !== layout) img.setAttribute('src', layout);
      return;
    }
    state.box = box;
    state.cars = new Map();
    box.innerHTML = `${layout ? `<img class="live-layout" src="${esc(layout)}" alt="Track layout">` : ''}
      <div class="lap"><span class="lap-label">Track</span><div class="lap-bar"><i class="sf" title="Start/finish line"></i></div></div>
      <div class="lap"><span class="lap-label">Pit road</span><div class="lap-pit"></div></div>
      <p class="lap-note">Start/finish on the left. Each car sits at its share of the lap, from NASCAR's timing.</p>`;
  }

  function carMarker(car) {
    const el = document.createElement('span');
    el.className = 'car';
    el.textContent = car;
    return el;
  }

  function draw() {
    state.raf = 0;
    if (!state.lr || !state.box || !document.body.contains(state.box)) return;
    const bar = state.box.querySelector('.lap-bar');
    const pit = state.box.querySelector('.lap-pit');
    const { live } = state.lr;
    const frozen = live.flag_state === RED || live.flag_state === CHECKERED;
    const now = state.clock0 + (frozen ? 0 : (performance.now() - state.at) / 1000);
    const seen = new Set();
    positions(live.vehicles, now).sort((a, b) => b.pos - a.pos).forEach((p) => {
      if (p.where === 'out') return;
      seen.add(p.car);
      const el = state.cars.get(p.car) || state.cars.set(p.car, carMarker(p.car)).get(p.car);
      el.className = `car${p.pos === 1 ? ' lead' : p.pos <= 3 ? ' top' : ''}`;
      if (p.where === 'pit') {
        el.style.left = '';
        if (el.parentNode !== pit) pit.appendChild(el);
      } else {
        el.style.left = `${(p.f * 100).toFixed(2)}%`;
        bar.appendChild(el);                            // later = drawn on top, so the leader sits over the pack
      }
    });
    state.cars.forEach((el, car) => { if (!seen.has(car)) { el.remove(); state.cars.delete(car); } });
    if (!frozen) state.raf = requestAnimationFrame(draw);
  }

  // ---------- the boards ----------
  function board(vehicles) {
    const order = vehicles.slice().sort((a, b) => a.running_position - b.running_position);
    const rows = order.map((v, i) => {
      const ahead = order[i - 1];
      const gap = i === 0 ? 'Leader' : v.delta < 0 ? `${-v.delta} lap${v.delta === -1 ? '' : 's'}` : `+${v.delta.toFixed(3)}`;
      const int = i > 0 && v.delta >= 0 && ahead && ahead.delta >= 0 ? `+${(v.delta - ahead.delta).toFixed(3)}` : '';
      const moved = v.starting_position - v.running_position;
      const stops = (v.pit_stops || []).filter((p) => p.pit_in_lap_count > 0);
      const last = stops[stops.length - 1];
      const status = !v.is_on_track ? 'Out' : inPits(v) ? 'Pit road' : v.is_on_dvp ? 'Damaged' : 'Running';
      return `<tr><td>${v.running_position}</td><td class="chg">${moved ? `<span class="${moved > 0 ? 'up' : 'dn'}">${moved > 0 ? '+' : ''}${moved}</span>` : ''}</td>
        <td><b>${esc(v.vehicle_number)}</b></td><td class="l">${esc(name(v.driver.full_name))}</td><td>${v.laps_completed}</td><td>${gap}</td><td>${int}</td>
        <td>${secs(v.last_lap_time)}</td><td>${v.last_lap_speed > 0 ? v.last_lap_speed.toFixed(3) : ''}</td><td>${secs(v.best_lap_time)}</td>
        <td>${lapsLed(v) || ''}</td><td>${stops.length}${last ? ` <small>lap ${last.pit_in_lap_count}</small>` : ''}</td>
        <td>${v.passing_differential > 0 ? '+' : ''}${v.passing_differential}</td><td class="l"><span class="status ${status === 'Running' ? 'alive' : 'eliminated'}">${status}</span></td></tr>`;
    }).join('');
    return `<div class="card"><div class="tbl" style="margin:0"><table><thead><tr><th>Pos</th><th>Start</th><th>No.</th><th class="l">Driver</th><th>Laps</th>
      <th>Gap</th><th>Interval</th><th>Last lap</th><th>Mph</th><th>Best lap</th><th>Led</th><th>Pit stops</th><th>Passes</th><th class="l">Status</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  function pitBoard(pits) {
    const stops = (pits || []).filter((p) => p.pit_in_race_time > 0).sort((a, b) => b.pit_in_race_time - a.pit_in_race_time).slice(0, PIT_STOPS_SHOWN);
    if (!stops.length) return '<p class="lede">No pit stops yet.</p>';
    return `<table class="mini"><thead><tr><th>Lap</th><th>No.</th><th class="l">Driver</th><th class="l">Stop</th><th>In box</th><th>Pit road</th><th>+/-</th></tr></thead><tbody>${stops.map((p) => `<tr>
      <td>${p.lap_count}</td><td><b>${esc(p.vehicle_number)}</b></td><td class="l">${esc(name(p.driver_name))}</td><td class="l">${esc(TYPE[p.pit_stop_type] || p.pit_stop_type)}${p.pit_in_flag_status === 1 ? ' <small>green</small>' : ''}</td>
      <td>${p.pit_stop_duration > 0 ? p.pit_stop_duration.toFixed(1) : ''}</td><td>${p.total_duration > 0 ? p.total_duration.toFixed(1) : ''}</td>
      <td>${p.positions_gained_lost ? `<span class="${p.positions_gained_lost > 0 ? 'up' : 'dn'}">${p.positions_gained_lost > 0 ? '+' : ''}${p.positions_gained_lost}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
  }

  function flagLog(flags) {
    const rows = (flags || []).filter((f) => f.lap_number > 0 || f.flag_state === 1).slice().reverse();
    if (!rows.length) return '<p class="lede">No flag changes yet.</p>';
    return `<table class="mini"><thead><tr><th>Lap</th><th class="l">Flag</th><th class="l">Why</th><th class="l">Free pass</th></tr></thead><tbody>${rows.map((f) => `<tr>
      <td>${f.lap_number}</td><td class="l"><span class="flag f${f.flag_state}">${esc(FLAG[f.flag_state] || f.flag_state)}</span></td>
      <td class="l">${esc(f.comment || '')}</td><td class="l">${esc((f.beneficiary || '').trim() ? `#${f.beneficiary.trim()}` : '')}</td></tr>`).join('')}</tbody></table>`;
  }

  function noteFeed(notes) {
    const laps = notes && notes.laps ? Object.keys(notes.laps).map(Number).sort((a, b) => b - a) : [];
    const items = laps.flatMap((lap) => notes.laps[lap].map((n) => ({ lap, n }))).slice(0, NOTES_SHOWN);
    if (!items.length) return '<p class="lede">No race notes yet.</p>';
    return `<ul class="notes-feed">${items.map(({ lap, n }) => `<li><b>Lap ${lap}</b> ${esc(n.Note)}</li>`).join('')}</ul>`;
  }

  function header(lr) {
    const { live, meta } = lr;
    const stage = live.stage && live.stage.stage_num ? ` / Stage ${live.stage.stage_num}, ends lap ${live.stage.finish_at_lap}` : '';
    const media = [meta.television_broadcaster && `TV: ${meta.television_broadcaster}`, meta.radio_broadcaster && `Radio: ${meta.radio_broadcaster}`,
      meta.satellite_radio_broadcaster && `Satellite: ${meta.satellite_radio_broadcaster}`].filter(Boolean).join(' / ');
    return `<div class="live-head"><span class="flag f${live.flag_state}">${esc(lr.flag)}</span><b>${esc(meta.race_name)}</b>
      <span>Lap ${live.lap_number} of ${live.laps_in_race}${stage}</span>
      <span>${live.number_of_caution_segments} cautions, ${live.number_of_caution_laps} caution laps, ${live.number_of_lead_changes} lead changes, ${live.number_of_leaders} leaders</span>
      ${media ? `<span class="media">${esc(media)}</span>` : ''}</div>`;
  }

  // ---------- entry point ----------
  // Renders the live view into `el` (kept between polls so the track is built once) and starts the cars moving.
  // `layout` is NASCAR's layout image for the track.
  function update(el, lr, layout) {
    state.lr = lr;
    state.clock0 = feedClock(lr.live);
    state.at = performance.now();
    if (!el.querySelector('.live-map')) {
      el.innerHTML = `<div class="live-top"></div><div class="live-grid"><div class="card live-map"></div><div class="live-side"></div></div><div class="live-board"></div>
        <div class="race-grid"><div class="card widget"><h3><span>Pit road</span><small>Latest stops</small></h3><div class="live-pits"></div></div>
        <div class="card widget"><h3><span>Flags</span><small>Cautions and why</small></h3><div class="live-flags"></div></div></div>`;
    }
    el.querySelector('.live-top').innerHTML = header(lr);
    el.querySelector('.live-side').innerHTML = `<div class="card widget"><h3><span>Race notes</span><small>From NASCAR</small></h3>${noteFeed(lr.notes)}</div>`;
    el.querySelector('.live-board').innerHTML = board(lr.live.vehicles);
    el.querySelector('.live-pits').innerHTML = pitBoard(lr.pits);
    el.querySelector('.live-flags').innerHTML = flagLog(lr.flags);
    mountTrack(el.querySelector('.live-map'), layout);
    if (!state.raf) state.raf = requestAnimationFrame(draw);
  }

  const api = { update, positions, lapFraction, feedClock, HOLD_AT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CupLive = api;
})(typeof window !== 'undefined' ? window : globalThis);
