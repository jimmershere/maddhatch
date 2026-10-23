/* Madd Hatchery — shared site chrome (announcement, header, nav, footer, cart drawer).
   Injected on every page so navigation can never drift between pages.

   v4: navigation is organised by visitor *intent* (shop / story / visit)
   rather than by product type. Structural UI uses inline SVG, not emoji —
   see docs/redesign-v4.md. Editable strings live in
   /assets/data/content.json so Trish can change them without touching code. */
(function () {
  const PAGE = document.body.dataset.page || '';
  const CONTACT = 'maddhatchery@gmail.com';

  /* ---------- icons (inline, currentColor) ---------- */
  const I = {
    menu: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    basket: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11h14l-1.2 7.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 11Z"/><path d="M9 11 7.5 5M15 11l1.5-6"/><path d="M3.5 11h17"/></svg>',
    chev: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    arrow: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    instagram: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/></svg>',
    facebook: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H8v3h2v7h3v-7h2.6l.4-3H13v-2c0-.6.4-1 1-1Z"/></svg>',
    tiktok: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 3h-2.7v12.1a2.6 2.6 0 1 1-2.6-2.6c.2 0 .5 0 .7.1v-2.8a5.6 5.6 0 0 0-.7 0 5.4 5.4 0 1 0 5.4 5.4V9.4a6.3 6.3 0 0 0 3.7 1.2V7.8A3.6 3.6 0 0 1 16.5 3Z"/></svg>',
    mail: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/></svg>',
  };
  window.MHIcons = I;

  /* ---------- navigation: grouped by visitor intent ---------- */
  const NAV = [
    { key: 'shop', label: 'Shop', menu: [
      { key: 'shop',   label: 'Everything',      href: '/shop.html',      sub: 'The whole farm stand' },
      { key: 'jams',   label: 'House Jams',      href: '/jams.html',      sub: 'Eight small-batch flavors' },
      { key: 'eggs',   label: 'Eggs & Chicks',   href: '/shop.html#eggs', sub: 'Farm pickup, reserve online' },
      { key: 'nickel', label: "Nickel T's",      href: '/nickel-ts.html', sub: 'Tees, mugs & stickers' },
      { key: 'drop',   label: 'The 2026 Drop',   href: '/drop.html',      sub: '20 new designs in the works' },
    ] },
    { key: 'story', label: 'Our Story', menu: [
      { key: 'about', label: 'Meet Trish',       href: '/about.html',  sub: 'Woman-owned, hand-made' },
      { key: 'farm',  label: 'Farm & Flock',     href: '/farm.html',   sub: 'The birds and the garden' },
      { key: 'art',   label: 'Madd Art',         href: '/maddart.html', sub: 'The design studio' },
    ] },
    { key: 'find', label: 'Visit', href: '/find-us.html' },
  ];

  function navItem(item) {
    const cur = (k) => (k === PAGE ? ' aria-current="page"' : '');
    if (item.menu) {
      const open = item.menu.some((m) => m.key === PAGE);
      const links = item.menu
        .map((m) => `<a href="${m.href}"${cur(m.key)}>${m.label}${m.sub ? `<em>${m.sub}</em>` : ''}</a>`)
        .join('');
      return `<div class="nav__group${open ? ' open' : ''}" data-group>
        <button class="nav__btn" data-group-toggle aria-expanded="${open}">${item.label} ${I.chev}</button>
        <div class="nav__menu">${links}</div>
      </div>`;
    }
    return `<a href="${item.href}"${cur(item.key)}>${item.label}</a>`;
  }

  /* ---------- announcement bar ---------- */
  const announce = document.createElement('div');
  announce.className = 'announce';
  announce.hidden = true;
  document.body.prepend(announce);

  /* ---------- header ---------- */
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="wrap site-header__bar">
      <a class="brand" href="/">
        <img src="/assets/v3/logo_2026_sm.png" alt="" width="42" height="48">
        <span><b>Madd Hatchery</b><span>Trish's Urban Farm</span></span>
      </a>
      <button class="nav__toggle" aria-label="Open menu" aria-expanded="false">${I.menu}</button>
      <nav class="nav" aria-label="Main">
        ${NAV.map(navItem).join('')}
        <button class="nav__cart" data-cart-open aria-label="Open basket">${I.basket}<span class="count" data-cart-count hidden>0</span></button>
      </nav>
    </div>`;
  announce.after(header);

  // mobile menu
  const toggle = header.querySelector('.nav__toggle');
  toggle.addEventListener('click', () => {
    const open = header.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    toggle.innerHTML = open ? I.close : I.menu;
  });

  // dropdowns
  header.querySelectorAll('[data-group-toggle]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = btn.closest('[data-group]');
      const willOpen = !group.classList.contains('open');
      header.querySelectorAll('[data-group].open').forEach((g) => { if (g !== group) g.classList.remove('open'); });
      group.classList.toggle('open', willOpen);
      btn.setAttribute('aria-expanded', String(willOpen));
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-group]')) header.querySelectorAll('[data-group].open').forEach((g) => g.classList.remove('open'));
  });

  /* ---------- footer ---------- */
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="wrap site-footer__grid">
      <div>
        <a class="brand" href="/" style="margin-bottom:1rem">
          <img src="/assets/v3/logo_2026_sm.png" alt="" width="42" height="48">
          <span><b>Madd Hatchery</b><span>Trish's Urban Farm</span></span>
        </a>
        <p style="opacity:.84;max-width:36ch;font-size:.9rem">Small-batch jams, farm-fresh eggs, baby chicks and handmade goods — cooked, packed and shipped by hand from a woman-owned urban farm.</p>
        <div class="socials" data-socials></div>
      </div>
      <div>
        <h4>Shop</h4>
        <ul>
          <li><a href="/shop.html">Everything</a></li>
          <li><a href="/jams.html">House Jams</a></li>
          <li><a href="/shop.html#eggs">Eggs &amp; Chicks</a></li>
          <li><a href="/nickel-ts.html">Nickel T's</a></li>
          <li><a href="/drop.html">The 2026 Drop</a></li>
        </ul>
      </div>
      <div>
        <h4>The Farm</h4>
        <ul>
          <li><a href="/about.html">Meet Trish</a></li>
          <li><a href="/farm.html">Farm &amp; Flock</a></li>
          <li><a href="/maddart.html">Madd Art</a></li>
          <li><a href="/find-us.html">Find Us</a></li>
        </ul>
      </div>
      <div>
        <h4>Help</h4>
        <ul>
          <li><a href="mailto:${CONTACT}">Contact</a></li>
          <li><a href="/find-us.html#pickup">Shipping &amp; pickup</a></li>
          <li><a href="mailto:${CONTACT}?subject=Wholesale%20enquiry">Wholesale</a></li>
          <li><a href="mailto:${CONTACT}?subject=Custom%20gift%20box">Custom gift boxes</a></li>
        </ul>
      </div>
    </div>
    <div class="wrap foot-bottom">
      <span>© <span data-year></span> Madd Hatchery · Woman-owned &amp; family-run</span>
      <span><a href="mailto:${CONTACT}">${CONTACT}</a></span>
    </div>`;
  document.body.appendChild(footer);
  footer.querySelector('[data-year]').textContent = new Date().getFullYear();

  /* ---------- cart drawer shell (populated by commerce.js) ---------- */
  const scrim = document.createElement('div');
  scrim.className = 'drawer-scrim';
  scrim.dataset.cartClose = '';
  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.setAttribute('aria-label', 'Basket');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.innerHTML = `
    <div class="drawer__head">
      <h3>Your basket</h3>
      <button class="drawer__close" data-cart-close aria-label="Close basket">${I.close}</button>
    </div>
    <div class="drawer__items" data-cart-items></div>
    <div class="drawer__foot" data-cart-foot></div>`;
  document.body.append(scrim, drawer);

  /* ---------- content.json: editable strings, no code changes needed ----------
     Every block below self-hides when its data is absent, so the site never
     ships a placeholder claim. See docs/content-guide.md. */
  fetch('/assets/data/content.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => {
      if (!c) return;
      window.MHContent = c;

      if (c.announcement && c.announcement.text) {
        announce.innerHTML = c.announcement.href
          ? `${esc(c.announcement.text)} <a href="${esc(c.announcement.href)}">${esc(c.announcement.cta || 'Shop now')}</a>`
          : esc(c.announcement.text);
        announce.hidden = false;
      }

      const soc = footer.querySelector('[data-socials]');
      const links = (c.socials || []).filter((s) => s.href);
      if (soc && links.length) {
        soc.innerHTML = links
          .map((s) => `<a href="${esc(s.href)}" aria-label="${esc(s.label || s.key)}" rel="me noopener" target="_blank">${I[s.key] || I.mail}</a>`)
          .join('');
      }
      document.dispatchEvent(new CustomEvent('mh:content', { detail: c }));
    })
    .catch(() => {});

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  window.MHesc = esc;
})();
