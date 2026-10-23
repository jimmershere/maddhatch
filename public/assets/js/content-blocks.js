/* Madd Hatchery — content-driven blocks.

   Renders the sections whose copy lives in /assets/data/content.json
   (testimonials, press, market schedule) and wires the newsletter form.

   Design rule: a block stays hidden until it has real, sourced data.
   An empty list is the correct state — it is never filled with invented
   quotes, press logos or follower counts (fleet rule 6). */
(function () {
  const esc = window.MHesc || ((s) => String(s == null ? '' : s));

  function stars(n) {
    const full = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    if (!full) return '';
    return `<div class="quote__stars" aria-label="${full} out of 5 stars">${
      Array.from({ length: full }, () =>
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="m12 17.6-5.3 3.1 1.4-6L3.4 10.6l6.1-.5L12 4.4l2.5 5.7 6.1.5-4.7 4.1 1.4 6z"/></svg>'
      ).join('')
    }</div>`;
  }

  function renderTestimonials(c) {
    const sec = document.querySelector('[data-testimonials]');
    const grid = document.querySelector('[data-testimonial-grid]');
    const items = (c.testimonials && c.testimonials.items) || [];
    if (!sec || !grid || !items.length) return;      // stays hidden
    grid.innerHTML = items
      .map(
        (t) => `<figure class="quote">
          ${stars(t.rating)}
          <p>“${esc(t.quote)}”</p>
          <footer>${esc(t.name)}${t.where ? ` · ${esc(t.where)}` : ''}</footer>
        </figure>`
      )
      .join('');
    sec.hidden = false;
  }

  function renderMarkets(c) {
    const sec = document.querySelector('[data-markets]');
    const list = document.querySelector('[data-market-list]');
    const items = (c.markets && c.markets.items) || [];
    if (!sec || !list || !items.length) return;      // stays hidden
    list.innerHTML = items
      .map(
        (m) => `<div class="panel">
          <h3>${esc(m.name)}</h3>
          <p class="card__desc">${esc(m.when || '')}${m.where ? `<br>${esc(m.where)}` : ''}</p>
          ${m.href ? `<a class="link-arrow" href="${esc(m.href)}">Details</a>` : ''}
        </div>`
      )
      .join('');
    sec.hidden = false;
  }

  function renderPress(c) {
    const sec = document.querySelector('[data-press]');
    const list = document.querySelector('[data-press-list]');
    const items = (c.press && c.press.items) || [];
    if (!sec || !list || !items.length) return;      // stays hidden
    list.innerHTML = items
      .map(
        (p) => `<li>${p.href ? `<a href="${esc(p.href)}" rel="noopener" target="_blank">${esc(p.outlet)}</a>` : esc(p.outlet)}${p.date ? ` <span class="note">${esc(p.date)}</span>` : ''}</li>`
      )
      .join('');
    sec.hidden = false;
  }

  /* ---------- newsletter ---------- */
  function wireSignup() {
    document.querySelectorAll('[data-signup]').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('input[type="email"]');
        const btn = form.querySelector('button[type="submit"]');
        const note = form.parentElement.querySelector('[data-signup-note]');
        const email = (input.value || '').trim();
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          if (note) note.textContent = 'That email doesn\'t look right — mind checking it?';
          input.focus();
          return;
        }
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Signing you up…';
        try {
          const res = await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, source: location.pathname }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.ok) {
            form.innerHTML = '<p style="margin:0;font-weight:700;color:#fff">You\'re on the list — talk soon. 🧺</p>';
            if (note) note.textContent = 'We\'ll only write when there\'s something worth writing about.';
            return;
          }
          if (note) note.textContent = data.message || 'Couldn\'t sign you up just now — try again in a minute.';
        } catch {
          if (note) note.textContent = 'Network hiccup — try again in a minute.';
        }
        btn.disabled = false;
        btn.textContent = label;
      });
    });
  }

  function apply(c) {
    if (!c) return;
    renderTestimonials(c);
    renderMarkets(c);
    renderPress(c);
  }

  // content.json may land before or after this script runs.
  if (window.MHContent) apply(window.MHContent);
  document.addEventListener('mh:content', (e) => apply(e.detail));
  wireSignup();
})();
