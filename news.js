// news.js v0.1.0: race day emails. The sign-up card (bottom right, every page) and the /newsletter page
// (sign up, confirm, choose emails, unsubscribe). Talks to the newsletter worker; shows nothing until NEWS_API is set.
(function (root) {
  'use strict';
  const NEWS_API = '';                       // the worker's https URL, set once it is deployed
  const KEY = 'cs-news';
  const SHOW_AFTER_MS = 8000;                // the card slides in 8 seconds after the page opens
  const SNOOZE_MS = 14 * 24 * 3600 * 1000;   // closed cards stay away for two weeks
  const TOPICS = [['morning', 'Race morning'], ['caution', 'Yellow flags'], ['mid', 'Mid-race report'], ['results', 'Results and standings']];
  const NAME = Object.fromEntries(TOPICS);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: the card just shows again */ } },
  };

  async function call(method, path, body) {
    let data;
    try {
      const res = await fetch(NEWS_API + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      data = await res.json();
    } catch {
      throw new Error('Could not reach the server. Try again in a minute.');
    }
    if (!data.ok) throw new Error(data.error || 'Something went wrong. Try again in a minute.');
    return data;
  }
  const list = (keys) => keys.map((k) => NAME[k]).join(', ');
  const boxes = (checked) => `<div class="news-topics">${TOPICS.map(([k, label]) => `<label><input type="checkbox" name="topics" value="${k}"${checked.includes(k) ? ' checked' : ''}> ${label}</label>`).join('')}</div>`;
  const form = () => `<form class="news-form" novalidate>${boxes(TOPICS.map((t) => t[0]))}
    <input class="news-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <div class="news-row"><input type="email" name="email" placeholder="Email address" aria-label="Email address" autocomplete="email"><button class="pill" type="submit">Sign up</button></div>
    <p class="news-fine news-msg" role="status">We email you a link to confirm. Unsubscribe any time.</p></form>`;
  const sent = (email) => `<p class="news-done"><b>Check your inbox.</b> Tap the link we sent to ${esc(email)} to confirm.</p>`;
  const fail = (msg, err) => { msg.textContent = err; msg.classList.add('err'); };

  function wire(formEl, onDone) {
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formEl);
      const msg = formEl.querySelector('.news-msg');
      const btn = formEl.querySelector('button[type="submit"]');
      const email = String(fd.get('email') || '').trim();
      const topics = fd.getAll('topics');
      msg.classList.remove('err');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(msg, 'Enter a valid email address.');
      if (!topics.length) return fail(msg, 'Pick at least one email.');
      btn.disabled = true;
      try {
        await call('POST', '/api/subscribe', { email, topics, website: fd.get('website') });
        onDone(email);
      } catch (err) {
        fail(msg, err.message);
        btn.disabled = false;
      }
    });
  }

  // ---------- the card ----------
  function card() {
    if (!NEWS_API || location.pathname.startsWith('/newsletter')) return;
    const s = store.get();
    if (s.joined || (s.closed && Date.now() - s.closed < SNOOZE_MS)) return;
    const el = document.createElement('aside');
    el.className = 'news-card';
    el.setAttribute('aria-label', 'Stay on track');
    el.innerHTML = `<div class="news-band"><b>Stay on track</b><button class="news-x" type="button" aria-label="Close">&times;</button></div><div class="news-line"></div>
      <div class="news-body"><p>Free emails every Cup race. Pick yours.</p>${form()}</div>`;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() { store.set({ ...store.get(), closed: Date.now() }); el.remove(); document.removeEventListener('keydown', onKey); }
    el.querySelector('.news-x').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    wire(el.querySelector('form'), (email) => { store.set({ joined: Date.now() }); el.querySelector('.news-body').innerHTML = sent(email); });
    document.body.appendChild(el);
  }

  // ---------- the /newsletter page: ?a=confirm|manage|unsubscribe&t=<token> from the email links ----------
  const panel = (html) => `<div class="card news-panel">${html}</div>`;
  const manageLink = (t) => `<a class="pill" href="/newsletter?a=manage&amp;t=${encodeURIComponent(t)}">Choose your emails</a>`;
  function signupView(el) {
    el.innerHTML = panel(`<p class="eyebrow">Free with every Cup race</p><h2>Stay on track</h2>
      <ul class="news-list"><li><b>Race morning:</b> start time, TV, the starting lineup and the standings.</li><li><b>Yellow flags:</b> every caution as it flies, with the reason and the running order.</li>
      <li><b>Mid-race report:</b> the leaders, cautions and live points at halfway.</li><li><b>Results and standings:</b> the finish and the new points picture.</li></ul>${form()}`);
    wire(el.querySelector('form'), (email) => { store.set({ joined: Date.now() }); el.querySelector('.news-form').outerHTML = sent(email); });
  }
  async function confirmView(el, t) {
    el.innerHTML = panel('<p class="news-msg" role="status">Confirming</p>');
    try {
      const r = await call('POST', '/api/confirm', { t });
      store.set({ joined: Date.now() });
      el.innerHTML = panel(`<h2>You are in</h2><p>${esc(r.email)} gets: ${esc(list(r.topics))}.</p>${manageLink(t)}`);
    } catch (err) {
      el.innerHTML = panel(`<h2>That did not work</h2><p class="news-msg err">${esc(err.message)}</p><a class="pill" href="/newsletter">Sign up</a>`);
    }
  }
  async function manageView(el, t) {
    el.innerHTML = panel('<p class="news-msg" role="status">Loading your emails</p>');
    let r;
    try { r = await call('GET', `/api/prefs?t=${encodeURIComponent(t)}`); } catch (err) {
      el.innerHTML = panel(`<h2>Choose your emails</h2><p class="news-msg err">${esc(err.message)}</p><a class="pill" href="/newsletter">Sign up</a>`);
      return;
    }
    el.innerHTML = panel(`<h2>Choose your emails</h2><p>For ${esc(r.email)}.</p><form class="news-form">${boxes(r.topics)}
      <div class="news-row"><button class="pill" type="submit">Save</button><button class="pill ghost" type="button" data-all-off>Unsubscribe from all</button></div><p class="news-fine news-msg" role="status"></p></form>`);
    const f = el.querySelector('form'), msg = f.querySelector('.news-msg');
    const save = async (topics) => {
      msg.classList.remove('err');
      try {
        const s = await call('POST', '/api/prefs', { t, topics });
        msg.textContent = s.topics.length ? `Saved. You get: ${list(s.topics)}.` : 'Unsubscribed. You get no more Cup Standings emails.';
        f.querySelectorAll('input[name="topics"]').forEach((b) => { b.checked = s.topics.includes(b.value); });
      } catch (err) { fail(msg, err.message); }
    };
    f.addEventListener('submit', (e) => { e.preventDefault(); save(new FormData(f).getAll('topics')); });
    f.querySelector('[data-all-off]').addEventListener('click', () => save([]));
  }
  function unsubView(el, t) {
    el.innerHTML = panel(`<h2>Unsubscribe</h2><p>Stop every Cup Standings email to this address.</p><button class="pill" type="button">Unsubscribe</button><p class="news-fine news-msg" role="status"></p>`);
    const btn = el.querySelector('button'), msg = el.querySelector('.news-msg');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = await call('POST', '/api/unsubscribe', { t });
        el.innerHTML = panel(`<h2>You are unsubscribed</h2><p>${esc(r.email)} gets no more Cup Standings emails. Changed your mind?</p>${manageLink(t)}`);
      } catch (err) { fail(msg, err.message); btn.disabled = false; }
    });
  }
  // app.js calls this on every render (live data refreshes every few seconds); it draws once per address.
  function page(el) {
    if (el.dataset.for === location.href) return;
    el.dataset.for = location.href;
    if (!NEWS_API) { el.innerHTML = panel('<h2>Stay on track</h2><p>Sign-ups open soon.</p>'); return; }
    const q = new URLSearchParams(location.search);
    const view = { confirm: confirmView, manage: manageView, unsubscribe: unsubView }[q.get('a')] || signupView;
    view(el, q.get('t') || '');
  }

  setTimeout(card, SHOW_AFTER_MS);
  root.CupNews = { page };
})(window);
