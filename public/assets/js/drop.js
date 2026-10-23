/* Madd Hatchery — 2026 drop grids.

   Reads /assets/data/drop-2026.json and renders the design cards on
   /drop.html plus the teaser rail on the homepage and Nickel T's page.

   These designs are Printify DRAFTS, not products. Cards therefore show a
   status chip and never an add-to-basket button — the catalog in
   /api/products remains the only source of anything buyable. */
(function () {
  const esc = window.MHesc || ((s) => String(s == null ? '' : s));

  const STATUS = {
    concept: { label: 'Concept', cls: 'concept' },
    draft:   { label: 'In draft', cls: 'draft' },
    live:    { label: 'On sale',  cls: 'live' },
  };

  function card(d) {
    const st = STATUS[d.status] || STATUS.concept;
    const dark = d.lane === 'nickel';
    const art = d.art
      ? `<img src="${esc(d.art)}" alt="${esc(d.name)} design" loading="lazy">`
      : `<span class="note" style="text-align:center">Art in progress</span>`;
    // When the whole card is a link, the call-to-action must NOT be another
    // <a>: nested anchors are invalid, and the parser closes the outer one
    // early so the card body spills out as a sibling element.
    const cta = d.href
      ? '<span class="lane-tag">Shop &rarr;</span>'
      : '';
    const inner = `
      <div class="dcard__media">
        <span class="dcard__id">${esc(d.id)}</span>
        ${art}
      </div>
      <div class="dcard__body">
        <h3>${esc(d.name)}</h3>
        <p>${esc(d.blurb || '')}</p>
        <div class="dcard__foot">
          <span class="chip-status chip-status--${st.cls}">${st.label}</span>
          ${cta}
        </div>
      </div>`;
    const cls = `dcard${dark ? ' dcard--dark' : ''}`;
    return d.href
      ? `<a class="${cls}" href="${esc(d.href)}" style="color:inherit">${inner}</a>`
      : `<article class="${cls}">${inner}</article>`;
  }

  function render(data) {
    const all = data.designs || [];

    // full lane grids (/drop.html)
    document.querySelectorAll('[data-drop-grid]').forEach((el) => {
      const lane = el.dataset.dropGrid;
      const list = lane === 'all' ? all : all.filter((d) => d.lane === lane);
      el.innerHTML = list.length
        ? list.map(card).join('')
        : '<p class="lede">Nothing here yet — check back.</p>';
    });

    // lane counters
    document.querySelectorAll('[data-count]').forEach((el) => {
      const lane = el.dataset.count;
      const n = all.filter((d) => d.lane === lane).length;
      el.childNodes[0].nodeValue = String(n);
    });

    // teaser rails (homepage / nickel-ts) — first N of a lane, or a mix
    document.querySelectorAll('[data-drop-teaser]').forEach((el) => {
      const lane = el.dataset.dropTeaser;
      const limit = Number(el.dataset.limit || 4);
      let pool = lane === 'mix'
        ? [...all.filter((d) => d.lane === 'madd_style').slice(0, Math.ceil(limit / 2)),
           ...all.filter((d) => d.lane === 'nickel').slice(0, Math.floor(limit / 2))]
        : all.filter((d) => d.lane === lane);
      pool = pool.slice(0, limit);
      el.innerHTML = pool.map(card).join('');
      const sec = el.closest('[data-drop-section]');
      if (sec && pool.length) sec.hidden = false;
    });
  }

  fetch('/assets/data/drop-2026.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d) render(d); })
    .catch(() => {});
})();
