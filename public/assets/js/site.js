/* Madd Hatchery — shared site chrome (header, nav, footer, cart drawer).
   Injected on every page so the navigation can never drift again. */
(function () {
  const PAGE = document.body.dataset.page || '';
  const CONTACT = 'maddhatchery@gmail.com';

  const NAV = [
    { key: 'home',  label: 'Home',      href: '/' },
    { key: 'shop',  label: 'Shop',      href: '/shop.html' },
    { key: 'jams',  label: 'House Jams', href: '/jams.html' },
    { key: 'merch', label: 'Merch', menu: [
      { key: 'merch', label: 'All Merch & Swag', href: '/merch.html' },
      { key: 'tees',  label: "Howdy & Friends Tees", href: '/merch.html#tees' },
      { key: 'nickle', label: "Nickle T's (novelty)", href: '/tees.html' },
    ] },
    { key: 'farm',  label: 'Farm & Flock', menu: [
      { key: 'farm', label: 'Farm Life & Gallery', href: '/farm.html' },
      { key: 'art',  label: 'Art Projects', href: '/art.html' },
    ] },
    { key: 'find',  label: 'Find Us',    href: '/find-us.html' },
  ];

  function navItem(item) {
    const active = (k) => (k === PAGE ? ' aria-current="page"' : '');
    if (item.menu) {
      const open = item.menu.some((m) => m.key === PAGE);
      const links = item.menu.map((m) => `<a href="${m.href}"${active(m.key)}>${m.label}</a>`).join('');
      return `<div class="nav__group${open ? ' open' : ''}" data-group>
        <button class="nav__btn" data-group-toggle aria-expanded="${open}">${item.label} ▾</button>
        <div class="nav__menu">${links}</div>
      </div>`;
    }
    return `<a href="${item.href}"${active(item.key)}>${item.label}</a>`;
  }

  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="wrap site-header__bar">
      <a class="brand" href="/">
        <img src="/assets/v3/trish/trish_peace.png" alt="" width="44" height="44">
        <span><b>Madd Hatchery</b><span>Jams · Eggs · Flock</span></span>
      </a>
      <button class="nav__toggle" aria-label="Menu" aria-expanded="false">☰</button>
      <nav class="nav" aria-label="Main">
        ${NAV.map(navItem).join('')}
        <button class="nav__cart" data-cart-open aria-label="Open cart">🧺<span class="count" data-cart-count hidden>0</span></button>
      </nav>
    </div>`;
  document.body.prepend(header);

  // mobile menu
  const toggle = header.querySelector('.nav__toggle');
  toggle.addEventListener('click', () => {
    const open = header.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded', open);
  });
  // dropdowns
  header.querySelectorAll('[data-group-toggle]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = btn.closest('[data-group]');
      const willOpen = !group.classList.contains('open');
      header.querySelectorAll('[data-group].open').forEach((g) => { if (g !== group) g.classList.remove('open'); });
      group.classList.toggle('open', willOpen);
      btn.setAttribute('aria-expanded', willOpen);
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-group]')) header.querySelectorAll('[data-group].open').forEach((g) => g.classList.remove('open'));
  });

  // footer
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="wrap site-footer__grid">
      <div>
        <a class="brand" href="/" style="margin-bottom:.9rem">
          <img src="/assets/v3/trish/trish_peace.png" alt="" width="44" height="44">
          <span><b>Madd Hatchery</b><span>Trish's Urban Farm</span></span>
        </a>
        <p style="opacity:.85;max-width:34ch">Small-batch jams, farm-fresh eggs, baby chicks, and handmade goods — made by hand, sold with heart.</p>
        <p style="margin-top:.6rem"><a href="mailto:${CONTACT}">📧 ${CONTACT}</a></p>
      </div>
      <div>
        <h4>Shop</h4>
        <ul>
          <li><a href="/shop.html">Everything</a></li>
          <li><a href="/jams.html">House Jams</a></li>
          <li><a href="/merch.html">Merch &amp; Tees</a></li>
          <li><a href="/tees.html">Nickle T's</a></li>
        </ul>
      </div>
      <div>
        <h4>The Farm</h4>
        <ul>
          <li><a href="/farm.html">Farm &amp; Flock</a></li>
          <li><a href="/art.html">Art Projects</a></li>
          <li><a href="/find-us.html">Find Us</a></li>
          <li><a href="mailto:${CONTACT}">Wholesale &amp; Custom</a></li>
        </ul>
      </div>
    </div>
    <div class="wrap foot-bottom">
      <span>© <span data-year></span> Madd Hatchery · All rights reserved</span>
      <span>Made with love on the farm 🐓</span>
    </div>`;
  document.body.appendChild(footer);
  const yr = footer.querySelector('[data-year]'); if (yr) yr.textContent = new Date().getFullYear();

  // cart drawer shell (populated by commerce.js)
  const scrim = document.createElement('div'); scrim.className = 'drawer-scrim'; scrim.dataset.cartClose = '';
  const drawer = document.createElement('aside');
  drawer.className = 'drawer'; drawer.setAttribute('aria-label', 'Cart'); drawer.setAttribute('aria-hidden', 'true');
  drawer.innerHTML = `
    <div class="drawer__head">
      <h3>Your Basket 🧺</h3>
      <button class="drawer__close" data-cart-close aria-label="Close cart">✕</button>
    </div>
    <div class="drawer__items" data-cart-items></div>
    <div class="drawer__foot" data-cart-foot></div>`;
  document.body.append(scrim, drawer);
})();
