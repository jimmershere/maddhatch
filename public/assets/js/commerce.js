/* Madd Hatchery — storefront commerce: catalog, cart, Stripe checkout. */
(function () {
  const LS_KEY = 'mh_cart_v1';
  const money = (cents) => `$${(cents / 100).toFixed(2)}`;
  let CATALOG = [];          // [{id,...}]
  let byId = new Map();

  /* ---------- cart state ---------- */
  function readCart() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  }
  function writeCart(c) { localStorage.setItem(LS_KEY, JSON.stringify(c)); render(); }
  function clampQty(id, qty) {
    const p = byId.get(id);
    const max = p ? Math.max(0, p.quantity_available) : qty;
    return Math.max(0, Math.min(qty, max || qty));
  }
  function addToCart(id, qty = 1) {
    const cart = readCart();
    cart[id] = clampQty(id, (cart[id] || 0) + qty);
    if (cart[id] <= 0) delete cart[id];
    writeCart(cart);
    const p = byId.get(id);
    toast(p ? `Added ${p.name} 🧺` : 'Added to basket');
    openCart();
  }
  function setQty(id, qty) {
    const cart = readCart();
    const q = clampQty(id, qty);
    if (q <= 0) delete cart[id]; else cart[id] = q;
    writeCart(cart);
  }
  function count() { return Object.values(readCart()).reduce((a, b) => a + b, 0); }
  function lines() {
    const cart = readCart();
    return Object.entries(cart).map(([id, qty]) => ({ p: byId.get(Number(id)), qty: Number(qty) })).filter((l) => l.p);
  }
  function subtotal() { return lines().reduce((a, l) => a + l.p.price_cents * l.qty, 0); }

  /* ---------- drawer rendering ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  function updateCount() {
    const el = $('[data-cart-count]'); if (!el) return;
    const n = count(); el.textContent = n; el.hidden = n === 0;
  }
  function render() {
    updateCount();
    const wrap = $('[data-cart-items]'); const foot = $('[data-cart-foot]');
    if (!wrap || !foot) return;
    const ls = lines();
    if (!ls.length) {
      wrap.innerHTML = `<div class="cart-empty"><p style="font-size:2.4rem;margin:0">🧺</p><p>Your basket's empty.<br>Go fill it with something sweet.</p><a class="btn btn--sage" href="/shop.html">Shop the farm</a></div>`;
      foot.innerHTML = '';
      return;
    }
    wrap.innerHTML = ls.map(({ p, qty }) => `
      <div class="cart-line">
        <img src="${p.image_url || '/assets/v3/jars/jar_variety.png'}" alt="" loading="lazy">
        <div>
          <div class="nm">${esc(p.name)}</div>
          <div class="mt">${money(p.price_cents)} · ${p.fulfillment_type === 'pickup' ? 'farm pickup' : 'ships'}</div>
          <div class="qty" style="margin-top:.35rem">
            <button data-dec="${p.id}" aria-label="Decrease">−</button>
            <span>${qty}</span>
            <button data-inc="${p.id}" aria-label="Increase">+</button>
          </div>
        </div>
        <strong>${money(p.price_cents * qty)}</strong>
      </div>`).join('');
    const hasShip = ls.some((l) => l.p.fulfillment_type === 'ship');
    foot.innerHTML = `
      <div class="row"><span>Subtotal</span><span class="total">${money(subtotal())}</span></div>
      <p class="note">${hasShip ? 'Flat-rate shipping added at checkout.' : 'Pickup-only basket — arrange a time after checkout.'}</p>
      <button class="btn btn--block btn--lg" data-checkout>Checkout securely →</button>
      <p class="note center" style="margin-top:.6rem">🔒 Secure payment by Stripe</p>`;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ---------- drawer open/close ---------- */
  function openCart() { document.querySelector('.drawer')?.classList.add('open'); document.querySelector('.drawer-scrim')?.classList.add('open'); document.querySelector('.drawer')?.setAttribute('aria-hidden', 'false'); }
  function closeCart() { document.querySelector('.drawer')?.classList.remove('open'); document.querySelector('.drawer-scrim')?.classList.remove('open'); document.querySelector('.drawer')?.setAttribute('aria-hidden', 'true'); }

  /* ---------- checkout ---------- */
  async function checkout(btn) {
    const items = lines().map((l) => ({ product_id: l.p.id, quantity: l.qty }));
    if (!items.length) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Starting checkout…'; }
    try {
      const res = await fetch('/api/checkout/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (data.url) { window.location = data.url; return; }
      toast(data.message || 'Checkout is not available right now.');
    } catch { toast('Network error — please try again.'); }
    if (btn) { btn.disabled = false; btn.textContent = 'Checkout securely →'; }
  }

  /* ---------- shop grid ---------- */
  function productCard(p) {
    const out = !p.in_stock;
    return `<article class="card">
      <div class="card__media">
        <img src="${p.image_url || '/assets/v3/jars/jar_variety.png'}" alt="${esc(p.name)}" loading="lazy">
        <span class="card__tag card__tag--${p.fulfillment_type}">${p.fulfillment_type === 'pickup' ? '🚜 Farm pickup' : '📦 Ships'}</span>
      </div>
      <div class="card__body">
        <h3>${esc(p.name)}</h3>
        <p class="card__desc">${esc(p.description || '')}</p>
        <div class="card__foot">
          <span class="price">${money(p.price_cents)}</span>
          <span class="stock${out ? ' stock--out' : ''}">${out ? 'Sold out' : `${p.quantity_available} left`}</span>
        </div>
        <button class="btn btn--block" data-add="${p.id}" ${out ? 'disabled' : ''}>${out ? 'Sold out' : 'Add to basket'}</button>
      </div>
    </article>`;
  }
  function renderShop() {
    const grid = $('[data-shop-grid]'); if (!grid) return;
    const filterBar = $('[data-shop-filters]');
    const LABELS = { jams: '🍯 Jams', eggs: '🥚 Eggs', chicks: '🐣 Chicks', 'hatching-eggs': '🥚 Hatching Eggs', birds: '🐓 Grown Birds', 'nickel-tee': "🦝 Nickel T's", 'madd-tee': '👕 Madd Hatchery', mug: '☕ Mugs', sticker: '✨ Stickers' };
    // Optional scope: data-shop-categories="nickel-tee,madd-tee,mug,sticker"
    const scope = (grid.dataset.shopCategories || '').split(',').map((s) => s.trim()).filter(Boolean);
    let POOL = scope.length ? CATALOG.filter((p) => scope.includes(p.category)) : CATALOG;
    const cats = scope.length ? scope.filter((c) => POOL.some((p) => p.category === c)) : [...new Set(POOL.map((p) => p.category))];
    let active = (location.hash || '').replace('#', '') || 'all';
    if (filterBar) {
      filterBar.innerHTML = ['all', ...cats].map((c) =>
        `<button class="btn ${c === active ? '' : 'btn--ghost'}" data-filter="${c}">${c === 'all' ? '✨ Everything' : (LABELS[c] || c)}</button>`).join('');
    }
    const draw = () => {
      const items = active === 'all' ? POOL : POOL.filter((p) => p.category === active);
      grid.innerHTML = items.length ? items.map(productCard).join('') : '<p class="lede">Fresh designs landing soon — check back!</p>';
      if (filterBar) filterBar.querySelectorAll('[data-filter]').forEach((b) =>
        b.classList.toggle('btn--ghost', b.dataset.filter !== active));
    };
    draw();
    if (filterBar) filterBar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]'); if (!b) return;
      active = b.dataset.filter; history.replaceState(null, '', active === 'all' ? location.pathname : `#${active}`); draw();
    });
  }

  /* ---------- featured (home/jams) ---------- */
  function renderFeatured() {
    document.querySelectorAll('[data-featured]').forEach((el) => {
      const cat = el.dataset.featured;
      const limit = Number(el.dataset.limit || 3);
      const items = (cat === 'all' ? CATALOG : CATALOG.filter((p) => p.category === cat)).slice(0, limit);
      el.innerHTML = items.map(productCard).join('');
    });
  }

  /* ---------- global click delegation ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-cart-open]')) return openCart();
    if (t.closest('[data-cart-close]')) return closeCart();
    const add = t.closest('[data-add]'); if (add) return addToCart(Number(add.dataset.add), 1);
    const inc = t.closest('[data-inc]'); if (inc) return setQty(Number(inc.dataset.inc), (readCart()[inc.dataset.inc] || 0) + 1);
    const dec = t.closest('[data-dec]'); if (dec) return setQty(Number(dec.dataset.dec), (readCart()[dec.dataset.dec] || 0) - 1);
    if (t.closest('[data-checkout]')) return checkout(t.closest('[data-checkout]'));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCart(); });

  /* ---------- toast ---------- */
  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  /* ---------- boot ---------- */
  async function boot() {
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      CATALOG = data.products || [];
      byId = new Map(CATALOG.map((p) => [p.id, p]));
    } catch { CATALOG = []; }
    render(); renderShop(); renderFeatured();
  }
  window.MH = { addToCart, openCart, closeCart, toast };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
