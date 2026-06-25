/* Madd Hatchery — storefront commerce: catalog, variants, cart, Stripe checkout. */
(function () {
  const LS_KEY = 'mh_cart_v2';
  const money = (cents) => `$${(cents / 100).toFixed(2)}`;
  const $ = (s, r = document) => r.querySelector(s);
  let CATALOG = [];
  let byId = new Map();

  /* ---------- cart (keyed by product+variant; stores a snapshot) ---------- */
  function readCart() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
  function writeCart(c) { localStorage.setItem(LS_KEY, JSON.stringify(c)); render(); }
  const keyOf = (pid, pvid) => `${pid}:${pvid || 0}`;

  function addItem(it) {
    const cart = readCart();
    const k = keyOf(it.product_id, it.pvid);
    const cur = cart[k] || { ...it, qty: 0 };
    cur.qty = Math.max(1, (cur.qty || 0) + (it.qty || 1));
    cart[k] = { ...it, qty: cur.qty };
    writeCart(cart);
    toast(`Added ${it.name} 🧺`);
    openCart();
  }
  function setQty(k, qty) {
    const cart = readCart();
    if (!cart[k]) return;
    if (qty <= 0) delete cart[k]; else cart[k].qty = qty;
    writeCart(cart);
  }
  function items() { return Object.entries(readCart()).map(([k, v]) => ({ k, ...v })); }
  function count() { return items().reduce((a, l) => a + l.qty, 0); }
  function subtotal() { return items().reduce((a, l) => a + l.price_cents * l.qty, 0); }

  function updateCount() { const el = $('[data-cart-count]'); if (!el) return; const n = count(); el.textContent = n; el.hidden = n === 0; }

  function render() {
    updateCount();
    const wrap = $('[data-cart-items]'); const foot = $('[data-cart-foot]');
    if (!wrap || !foot) return;
    const ls = items();
    if (!ls.length) {
      wrap.innerHTML = `<div class="cart-empty"><p style="font-size:2.4rem;margin:0">🧺</p><p>Your basket's empty.<br>Go fill it with something good.</p><a class="btn btn--sage" href="/shop.html">Shop the farm</a></div>`;
      foot.innerHTML = ''; return;
    }
    wrap.innerHTML = ls.map((l) => `
      <div class="cart-line">
        <img src="${l.image_url || '/assets/v3/jars/jar_variety.png'}" alt="" loading="lazy">
        <div>
          <div class="nm">${esc(l.name)}</div>
          <div class="mt">${money(l.price_cents)}${l.color ? ` · ${esc(l.color)}${l.size ? ' / ' + esc(l.size) : ''}` : (l.fulfillment === 'pickup' ? ' · farm pickup' : '')}</div>
          <div class="qty" style="margin-top:.35rem">
            <button data-dec="${l.k}" aria-label="Decrease">−</button><span>${l.qty}</span><button data-inc="${l.k}" aria-label="Increase">+</button>
          </div>
        </div>
        <strong>${money(l.price_cents * l.qty)}</strong>
      </div>`).join('');
    const hasShip = ls.some((l) => l.fulfillment !== 'pickup');
    foot.innerHTML = `
      <div class="row"><span>Subtotal</span><span class="total">${money(subtotal())}</span></div>
      <p class="note">${hasShip ? 'Flat-rate shipping added at checkout.' : 'Pickup-only basket — we\'ll arrange a time.'}</p>
      <button class="btn btn--block btn--lg" data-checkout>Checkout securely →</button>
      <p class="note center" style="margin-top:.6rem">🔒 Secure payment by Stripe</p>`;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function openCart() { document.querySelector('.drawer')?.classList.add('open'); document.querySelector('.drawer-scrim')?.classList.add('open'); document.querySelector('.drawer')?.setAttribute('aria-hidden', 'false'); }
  function closeCart() { document.querySelector('.drawer')?.classList.remove('open'); document.querySelector('.drawer-scrim')?.classList.remove('open'); document.querySelector('.drawer')?.setAttribute('aria-hidden', 'true'); }

  async function checkout(btn) {
    const its = items().map((l) => ({ product_id: l.product_id, printify_variant_id: l.pvid || undefined, quantity: l.qty }));
    if (!its.length) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Starting checkout…'; }
    try {
      const res = await fetch('/api/checkout/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: its }) });
      const data = await res.json();
      if (data.url) { window.location = data.url; return; }
      toast(data.message || 'Checkout is not available right now.');
    } catch { toast('Network error — please try again.'); }
    if (btn) { btn.disabled = false; btn.textContent = 'Checkout securely →'; }
  }

  /* ---------- shop grid ---------- */
  function productCard(p) {
    const out = !p.in_stock;
    const priceLbl = p.has_variants ? `from ${money(p.price_cents)}` : money(p.price_cents);
    const cta = p.has_variants
      ? `<a class="btn btn--block" href="/p.html?slug=${encodeURIComponent(p.slug)}">Choose options</a>`
      : `<button class="btn btn--block" data-add="${p.id}" ${out ? 'disabled' : ''}>${out ? 'Sold out' : 'Add to basket'}</button>`;
    return `<article class="card">
      <a class="card__media" href="/p.html?slug=${encodeURIComponent(p.slug)}" style="display:block">
        <img src="${p.image_url || '/assets/v3/jars/jar_variety.png'}" alt="${esc(p.name)}" loading="lazy">
        <span class="card__tag card__tag--${p.fulfillment_type}">${p.fulfillment_type === 'pickup' ? '🚜 Farm pickup' : '📦 Ships'}</span>
      </a>
      <div class="card__body">
        <h3>${esc(p.name)}</h3>
        <p class="card__desc">${esc(p.description || '')}</p>
        <div class="card__foot">
          <span class="price">${priceLbl}</span>
          ${p.has_variants ? `<span class="stock">${(p.colors || []).length} colors · ${(p.sizes || []).length} sizes</span>` : `<span class="stock${out ? ' stock--out' : ''}">${out ? 'Sold out' : `${p.quantity_available} left`}</span>`}
        </div>
        ${cta}
      </div>
    </article>`;
  }
  function renderShop() {
    const grid = $('[data-shop-grid]'); if (!grid) return;
    const filterBar = $('[data-shop-filters]');
    const LABELS = { jams: '🍯 Jams', eggs: '🥚 Eggs', chicks: '🐣 Chicks', 'hatching-eggs': '🥚 Hatching Eggs', birds: '🐓 Grown Birds', 'nickel-tee': "🦝 Nickel T's", 'madd-tee': '👕 Madd Hatchery', 'tie-dye': '🌀 Tie-Dye', mug: '☕ Mugs', sticker: '✨ Stickers', bottle: '💧 Water Bottles' };
    const scope = (grid.dataset.shopCategories || '').split(',').map((s) => s.trim()).filter(Boolean);
    const POOL = scope.length ? CATALOG.filter((p) => scope.includes(p.category)) : CATALOG;
    const cats = scope.length ? scope.filter((c) => POOL.some((p) => p.category === c)) : [...new Set(POOL.map((p) => p.category))];
    let active = (location.hash || '').replace('#', '') || 'all';
    if (filterBar) filterBar.innerHTML = ['all', ...cats].map((c) => `<button class="btn ${c === active ? '' : 'btn--ghost'}" data-filter="${c}">${c === 'all' ? '✨ Everything' : (LABELS[c] || c)}</button>`).join('');
    const draw = () => {
      const list = active === 'all' ? POOL : POOL.filter((p) => p.category === active);
      grid.innerHTML = list.length ? list.map(productCard).join('') : '<p class="lede">Fresh designs landing soon — check back!</p>';
      if (filterBar) filterBar.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('btn--ghost', b.dataset.filter !== active));
    };
    draw();
    if (filterBar) filterBar.addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (!b) return; active = b.dataset.filter; history.replaceState(null, '', active === 'all' ? location.pathname : `#${active}`); draw(); });
  }
  function renderFeatured() {
    document.querySelectorAll('[data-featured]').forEach((el) => {
      const cat = el.dataset.featured; const limit = Number(el.dataset.limit || 3);
      const list = (cat === 'all' ? CATALOG : CATALOG.filter((p) => p.category === cat)).slice(0, limit);
      el.innerHTML = list.map(productCard).join('');
    });
  }

  /* ---------- product detail page (/p.html?slug=) ---------- */
  async function renderProductPage() {
    const root = $('[data-product-page]'); if (!root) return;
    const slug = new URLSearchParams(location.search).get('slug');
    if (!slug) { root.innerHTML = '<p class="lede">No product specified.</p>'; return; }
    let p;
    try { const r = await fetch('/api/product/' + encodeURIComponent(slug)); const d = await r.json(); p = d.product; } catch {}
    if (!p) { root.innerHTML = '<p class="lede">Sorry, that product isn\'t available.</p>'; return; }
    document.title = `${p.name} — Madd Hatchery`;

    if (!p.has_variants) {
      root.innerHTML = `<div class="split">
        <div class="panel" style="padding:0;overflow:hidden"><img src="${p.image_url}" alt="${esc(p.name)}"></div>
        <div><span class="eyebrow">Madd Hatchery</span><h1>${esc(p.name)}</h1>
        <p class="lede">${esc(p.description || '')}</p><p class="price" style="font-size:1.8rem">${money(p.price_cents)}</p>
        <button class="btn btn--lg" id="pdp-add" ${p.in_stock ? '' : 'disabled'}>${p.in_stock ? 'Add to basket' : 'Sold out'}</button></div></div>`;
      if (p.in_stock) $('#pdp-add').addEventListener('click', () => addItem({ product_id: p.id, pvid: 0, name: p.name, image_url: p.image_url, price_cents: p.price_cents, fulfillment: p.fulfillment_type, qty: 1 }));
      return;
    }

    const SZ = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'One Size'];
    p.sizes = (p.sizes || []).slice().sort((a, b) => (SZ.indexOf(a) + 1 || 99) - (SZ.indexOf(b) + 1 || 99));
    let color = p.colors[0]; let size = p.sizes[0]; let qty = 1;
    const variantFor = (c, s) => p.variants.find((v) => v.color === c.name && v.size === s);
    const draw = () => {
      const v = variantFor(color, size);
      const views = [color.image_url, color.front_image_url].filter(Boolean);
      const thumbs = views.length > 1 ? `<div style="display:flex;gap:.5rem;margin-top:.6rem">${views.map((u, i) => `<button class="pdp-th" data-u="${u}" style="width:64px;height:64px;border-radius:10px;border:2px solid ${i === 0 ? 'var(--teal-dk)' : 'var(--line)'};background:var(--cream-2) center/contain no-repeat url('${u}');cursor:pointer"></button>`).join('')}</div>` : '';
      root.innerHTML = `<div class="split">
        <div>
          <div class="panel" style="padding:1rem;overflow:hidden;background:var(--cream-2)"><img id="pdp-img" src="${color.image_url}" alt="${esc(p.name)} — ${esc(color.name)}" style="display:block;width:100%"></div>
          ${thumbs}
        </div>
        <div>
          <span class="eyebrow">Madd Hatchery</span><h1>${esc(p.name)}</h1>
          <p class="lede">${esc(p.description || '')}</p>
          <p class="price" style="font-size:1.8rem">${v ? money(v.price_cents) : money(p.price_cents)}</p>
          <div style="margin:1rem 0"><strong style="display:block;margin-bottom:.4rem">Color: <span id="pdp-color">${esc(color.name)}</span></strong>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap">${p.colors.map((c, i) => `<button class="pdp-sw" data-ci="${i}" title="${esc(c.name)}" style="width:38px;height:38px;border-radius:50%;border:3px solid ${c.name === color.name ? 'var(--teal-dk)' : 'transparent'};background:${c.hex || '#ccc'};box-shadow:0 0 0 1px #bbb;cursor:pointer"></button>`).join('')}</div></div>
          <div style="margin:1rem 0"><strong style="display:block;margin-bottom:.4rem">Size</strong>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap">${p.sizes.map((s) => `<button class="pdp-sz btn ${s === size ? '' : 'btn--ghost'}" data-sz="${esc(s)}" style="min-width:54px">${esc(s)}</button>`).join('')}</div></div>
          <div style="margin:1rem 0;display:flex;align-items:center;gap:1rem"><strong>Qty</strong>
            <div class="qty"><button id="pdp-dec">−</button><span id="pdp-qty">${qty}</span><button id="pdp-inc">+</button></div></div>
          <button class="btn btn--lg btn--block" id="pdp-add" ${v ? '' : 'disabled'}>${v ? 'Add to basket' : 'Unavailable'}</button>
          <p class="note" style="margin-top:.6rem">📦 Printed on demand & shipped from our partner. Soft, true-to-size.</p>
        </div></div>`;
      root.querySelectorAll('.pdp-th').forEach((b) => b.addEventListener('click', () => {
        const img = $('#pdp-img'); if (img) img.src = b.dataset.u;
        root.querySelectorAll('.pdp-th').forEach((x) => x.style.borderColor = 'var(--line)'); b.style.borderColor = 'var(--teal-dk)';
      }));
      root.querySelectorAll('.pdp-sw').forEach((b) => b.addEventListener('click', () => { color = p.colors[Number(b.dataset.ci)]; draw(); }));
      root.querySelectorAll('.pdp-sz').forEach((b) => b.addEventListener('click', () => { size = b.dataset.sz; draw(); }));
      $('#pdp-inc').addEventListener('click', () => { qty++; $('#pdp-qty').textContent = qty; });
      $('#pdp-dec').addEventListener('click', () => { qty = Math.max(1, qty - 1); $('#pdp-qty').textContent = qty; });
      const addBtn = $('#pdp-add');
      if (v) addBtn.addEventListener('click', () => addItem({ product_id: p.id, pvid: v.printify_variant_id, color: color.name, size, name: `${p.name} — ${color.name} / ${size}`, image_url: color.image_url, price_cents: v.price_cents, fulfillment: 'ship', qty }));
    };
    draw();
  }

  /* ---------- delegation, toast, boot ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-cart-open]')) return openCart();
    if (t.closest('[data-cart-close]')) return closeCart();
    const add = t.closest('[data-add]'); if (add) { const p = byId.get(Number(add.dataset.add)); if (p) addItem({ product_id: p.id, pvid: 0, name: p.name, image_url: p.image_url, price_cents: p.price_cents, fulfillment: p.fulfillment_type, qty: 1 }); return; }
    const inc = t.closest('[data-inc]'); if (inc) { const c = readCart()[inc.dataset.inc]; return setQty(inc.dataset.inc, (c ? c.qty : 0) + 1); }
    const dec = t.closest('[data-dec]'); if (dec) { const c = readCart()[dec.dataset.dec]; return setQty(dec.dataset.dec, (c ? c.qty : 0) - 1); }
    if (t.closest('[data-checkout]')) return checkout(t.closest('[data-checkout]'));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCart(); });

  let toastEl, toastTimer;
  function toast(msg) { if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); } toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200); }

  async function boot() {
    try { const r = await fetch('/api/products'); CATALOG = (await r.json()).products || []; byId = new Map(CATALOG.map((p) => [p.id, p])); } catch { CATALOG = []; }
    render(); renderShop(); renderFeatured(); renderProductPage();
  }
  window.MH = { addItem, openCart, closeCart, toast };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
