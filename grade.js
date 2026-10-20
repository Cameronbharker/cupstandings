// grade.js v0.1.0: The Grade. Every format scores each driver on position, margin and title status,
// each 0-100 and equal weight; every format then counts the same toward the final score.
(function (root) {
  'use strict';

  // Position: finish in the format, on the original A+ to F rank scale, as 0-100.
  const RANK_SCALE = [[1, 'A+', 4.3], [3, 'A', 4.0], [5, 'A-', 3.7], [8, 'B+', 3.3], [12, 'B', 3.0], [16, 'B-', 2.7],
    [20, 'C+', 2.3], [24, 'C', 2.0], [28, 'C-', 1.7], [32, 'D', 1.0], [Infinity, 'F', 0]];
  const positionScore = (rank) => (RANK_SCALE.find(([max]) => rank <= max)[2] / 4.3) * 100;

  // Margin: points behind that format's leader, counted in average race wins in that format. 10 wins back scores 0.
  const MARGIN_WINS = 10;
  const marginScore = (gapWins) => Math.max(0, 100 * (1 - gapWins / MARGIN_WINS));

  // Title status: where the format's own rules leave the driver in the championship.
  const STATUS_SCORE = { champion: 100, final4: 90, clinched: 85, alive: 75, chase: 75, projected: 75, out: 0 };
  const ELIMINATED_SCORE = { 1: 40, 2: 50, 3: 60 };   // out in the Round of 16, 12, 8
  const OUT_OF_REACH = 30;                             // in the field but mathematically unable to catch the leader
  const FIELD_FINISH = 50;                             // finished a completed season inside the playoff field

  function titleScore(row, gap, res) {
    const reachable = gap <= res.remaining * res.scale.maxRace;
    if (row.status === 'eliminated') return ELIMINATED_SCORE[row.elimRound] || 40;
    if (row.status === 'season') return res.done ? 0 : reachable ? STATUS_SCORE.alive : 0;
    if (row.status === 'chase' && res.locked) return res.done ? FIELD_FINISH : reachable ? STATUS_SCORE.chase : OUT_OF_REACH;
    return STATUS_SCORE[row.status] != null ? STATUS_SCORE[row.status] : 0;
  }

  // Final letter from the 0-100 score.
  // Calibrated on the 2026 season after race 33: Chase-caliber drivers scored 38-87, the rest 1-28.
  const LETTERS = [[90, 'A+'], [84, 'A'], [80, 'A-'], [75, 'B+'], [70, 'B'], [62, 'B-'], [55, 'C+'], [45, 'C'], [35, 'C-'], [20, 'D'], [-Infinity, 'F']];
  const letterFor = (score) => LETTERS.find(([min]) => score >= min)[1];

  function scoreFormat(res, id) {
    const idx = res.rows.findIndex((r) => r.id === id);
    if (idx === -1) return { rank: res.rows.length + 1, position: 0, margin: 0, title: 0, gapWins: null, score: 0, letter: 'F' };
    const row = res.rows[idx];
    const gap = Math.max(0, res.rows[0].pts - row.pts);
    const gapWins = gap / res.scale.avgWin;
    const position = positionScore(idx + 1);
    const margin = marginScore(gapWins);
    const title = titleScore(row, gap, res);
    const score = (position + margin + title) / 3;
    return { rank: idx + 1, position, margin, title, gapWins, score, letter: letterFor(score) };
  }

  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  function build(results, stats, minStarts) {
    const keys = Object.keys(results);
    const ids = [...stats.keys()].filter((id) => stats.get(id).starts >= minStarts);
    const rows = ids.map((id) => {
      const per = Object.fromEntries(keys.map((k) => [k, scoreFormat(results[k], id)]));
      const pick = (field) => mean(keys.map((k) => per[k][field]));
      const ranks = keys.map((k) => per[k].rank);
      const worst = Math.max(...ranks);
      return {
        id, per, score: pick('score'), position: pick('position'), margin: pick('margin'), title: pick('title'),
        avgRank: mean(ranks), best: Math.min(...ranks), worst,
        tier: worst <= 5 ? 'complete' : worst <= 10 ? 'contender' : worst <= 16 ? 'chase' : null,
      };
    });
    rows.sort((a, b) => b.score - a.score || a.avgRank - b.avgRank || a.worst - b.worst);
    return rows.map((r, i) => ({ ...r, rank: i + 1, letter: letterFor(r.score) }));
  }

  const api = { build, letterFor, positionScore, marginScore, LETTERS, MARGIN_WINS, STATUS_SCORE, ELIMINATED_SCORE, OUT_OF_REACH, FIELD_FINISH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PointsGrade = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
