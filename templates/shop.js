/* ==========================================================
   Moteur commun des templates e-commerce de démonstration
   (catalogue, filtres, fiche produit, favoris, panier)
   Chaque page définit window.SHOP = { key, freeShipping, products, labels? }
   ========================================================== */
(() => {
  const S = window.SHOP;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = (n) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const byId = Object.fromEntries(S.products.map((p) => [p.id, p]));

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(`${S.key}:${k}`)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`${S.key}:${k}`, JSON.stringify(v)); } catch {} },
  };
  let cart = store.get('cart', []).filter((l) => byId[l.id]);
  let favs = new Set(store.get('favs', []).filter((id) => byId[id]));
  let filter = 'all';
  let sort = 'featured';

  /* ---------- Éléments injectés : panier, fiche produit, toast ---------- */
  document.body.insertAdjacentHTML('beforeend', `
    <div class="sh-veil" data-close></div>
    <aside class="sh-drawer" id="sh-cart" aria-label="Panier" aria-hidden="true">
      <header><h2>Panier</h2><button class="sh-x" data-close aria-label="Fermer">✕</button></header>
      <div class="sh-ship"><p></p><div class="sh-bar"><i></i></div></div>
      <ul class="sh-lines"></ul>
      <footer>
        <p class="sh-total"><span>Sous-total</span><b></b></p>
        <button class="sh-btn sh-checkout" type="button">Commander</button>
        <p class="sh-note"></p>
      </footer>
    </aside>
    <div class="sh-modal" id="sh-modal" role="dialog" aria-modal="true" aria-hidden="true">
      <div class="sh-sheet">
        <button class="sh-x" data-close aria-label="Fermer">✕</button>
        <div class="sh-sheet-img"><img alt="" /></div>
        <div class="sh-sheet-body">
          <p class="sh-cat"></p>
          <h2></h2>
          <p class="sh-price"></p>
          <p class="sh-desc"></p>
          <div class="sh-sizes"></div>
          <div class="sh-sheet-ctas">
            <button class="sh-btn sh-add" type="button">Ajouter au panier</button>
            <button class="sh-fav-big" type="button" aria-label="Ajouter aux favoris">♡</button>
          </div>
          <ul class="sh-perks"><li>Livraison offerte dès ${fmt(S.freeShipping)}</li><li>Retours gratuits sous 30 jours</li><li>Paiement sécurisé</li></ul>
        </div>
      </div>
    </div>
    <div class="sh-toast" role="status" aria-live="polite"></div>`);

  const drawer = $('#sh-cart');
  const modal = $('#sh-modal');
  const veil = $('.sh-veil');

  function open(el) {
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    veil.classList.add('open');
    document.documentElement.classList.add('sh-lock');
  }
  function closeAll() {
    [drawer, modal].forEach((el) => { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); });
    veil.classList.remove('open');
    document.documentElement.classList.remove('sh-lock');
  }
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeAll));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  let toastT;
  function toast(msg) {
    const t = $('.sh-toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- Catalogue ---------- */
  const grid = $('#sh-grid');
  function card(p) {
    const fav = favs.has(p.id);
    return `
      <article class="sh-card" data-id="${p.id}">
        <button class="sh-card-img" type="button" data-view="${p.id}" aria-label="Voir ${p.name}">
          <img src="${p.img}" alt="${p.name}" loading="lazy" />
          ${p.badge ? `<span class="sh-badge">${p.badge}</span>` : ''}
          <span class="sh-quick">Aperçu rapide</span>
        </button>
        <button class="sh-fav ${fav ? 'on' : ''}" type="button" data-fav="${p.id}" aria-label="Favori" aria-pressed="${fav}">${fav ? '♥' : '♡'}</button>
        <div class="sh-card-info">
          <p class="sh-card-cat">${p.cat}</p>
          <h3>${p.name}</h3>
          <p class="sh-card-price">${p.old ? `<s>${fmt(p.old)}</s>` : ''}<b>${fmt(p.price)}</b></p>
        </div>
        <button class="sh-add-mini" type="button" data-add="${p.id}">+ Ajouter</button>
      </article>`;
  }
  function render() {
    let list = S.products.filter((p) => filter === 'all' || p.cat === filter);
    if (sort === 'asc') list = [...list].sort((a, b) => a.price - b.price);
    if (sort === 'desc') list = [...list].sort((a, b) => b.price - a.price);
    if (sort === 'az') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    grid.innerHTML = list.map(card).join('');
    const c = $('#sh-count');
    if (c) c.textContent = `${list.length} article${list.length > 1 ? 's' : ''}`;
  }

  // Filtres générés depuis les catégories
  const filters = $('#sh-filters');
  if (filters) {
    const cats = ['all', ...new Set(S.products.map((p) => p.cat))];
    filters.innerHTML = cats.map((c) => `<button type="button" data-filter="${c}" class="${c === 'all' ? 'on' : ''}">${c === 'all' ? 'Tout' : c}</button>`).join('');
    filters.addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      filter = b.dataset.filter;
      $$('[data-filter]', filters).forEach((x) => x.classList.toggle('on', x === b));
      render();
    });
  }
  $('#sh-sort')?.addEventListener('change', (e) => { sort = e.target.value; render(); });
  // Liens de navigation vers une catégorie
  $$('[data-goto-cat]').forEach((a) => a.addEventListener('click', () => {
    const b = $(`[data-filter="${a.dataset.gotoCat}"]`);
    b?.click();
  }));

  /* ---------- Fiche produit ---------- */
  let current = null;
  let size = null;
  function view(id) {
    const p = byId[id];
    current = p;
    size = null;
    $('.sh-sheet-img img', modal).src = p.img;
    $('.sh-sheet-img img', modal).alt = p.name;
    $('.sh-cat', modal).textContent = p.cat;
    $('h2', modal).textContent = p.name;
    $('.sh-price', modal).innerHTML = `${p.old ? `<s>${fmt(p.old)}</s> ` : ''}${fmt(p.price)}`;
    $('.sh-desc', modal).textContent = p.desc;
    const sizes = $('.sh-sizes', modal);
    sizes.innerHTML = p.sizes ? `<p>${S.labels?.size || 'Taille'}</p><div>${p.sizes.map((s) => `<button type="button" data-size="${s}">${s}</button>`).join('')}</div>` : '';
    updateFavBig();
    open(modal);
  }
  modal.addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (!b) return;
    size = b.dataset.size;
    $$('[data-size]', modal).forEach((x) => x.classList.toggle('on', x === b));
  });
  $('.sh-add', modal).addEventListener('click', () => {
    if (current.sizes && !size) {
      toast(`Choisis d'abord une ${(S.labels?.size || 'taille').toLowerCase()}`);
      $('.sh-sizes', modal).classList.remove('shake');
      void $('.sh-sizes', modal).offsetWidth;
      $('.sh-sizes', modal).classList.add('shake');
      return;
    }
    add(current.id, size);
    closeAll();
    open(drawer);
  });
  function updateFavBig() {
    const on = favs.has(current.id);
    const b = $('.sh-fav-big', modal);
    b.textContent = on ? '♥' : '♡';
    b.classList.toggle('on', on);
  }
  $('.sh-fav-big', modal).addEventListener('click', () => { toggleFav(current.id); updateFavBig(); });

  /* ---------- Favoris ---------- */
  function toggleFav(id) {
    favs.has(id) ? favs.delete(id) : favs.add(id);
    store.set('favs', [...favs]);
    toast(favs.has(id) ? 'Ajouté aux favoris' : 'Retiré des favoris');
    updateBadges();
    render();
  }

  /* ---------- Panier ---------- */
  function add(id, sz = null) {
    const line = cart.find((l) => l.id === id && l.size === sz);
    if (line) line.qty++;
    else cart.push({ id, size: sz, qty: 1 });
    save();
    toast(`${byId[id].name} ajouté au panier`);
  }
  function save() {
    store.set('cart', cart);
    renderCart();
    updateBadges();
  }
  function renderCart() {
    const total = cart.reduce((s, l) => s + byId[l.id].price * l.qty, 0);
    const lines = $('.sh-lines', drawer);
    lines.innerHTML = cart.length
      ? cart.map((l, i) => {
        const p = byId[l.id];
        return `<li>
          <img src="${p.img}" alt="" />
          <div><p class="sh-l-name">${p.name}</p><p class="sh-l-meta">${l.size ? `${S.labels?.size || 'Taille'} ${l.size} · ` : ''}${fmt(p.price)}</p>
            <div class="sh-qty"><button type="button" data-dec="${i}" aria-label="Retirer un">−</button><span>${l.qty}</span><button type="button" data-inc="${i}" aria-label="Ajouter un">+</button></div>
          </div>
          <button class="sh-rm" type="button" data-rm="${i}" aria-label="Supprimer">✕</button>
        </li>`;
      }).join('')
      : `<li class="sh-empty">Ton panier est vide.<br />Ajoute un article pour tester le parcours d'achat.</li>`;
    $('.sh-total b', drawer).textContent = fmt(total);
    const left = S.freeShipping - total;
    $('.sh-ship p', drawer).textContent = cart.length === 0 ? `Livraison offerte dès ${fmt(S.freeShipping)}` : left > 0 ? `Plus que ${fmt(left)} pour la livraison offerte` : 'Livraison offerte !';
    $('.sh-bar i', drawer).style.width = `${Math.min(100, (total / S.freeShipping) * 100)}%`;
    $('.sh-checkout', drawer).disabled = cart.length === 0;
    $('.sh-note', drawer).textContent = '';
  }
  drawer.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.inc) cart[+t.dataset.inc].qty++;
    else if (t.dataset.dec) { const l = cart[+t.dataset.dec]; l.qty--; if (l.qty <= 0) cart.splice(+t.dataset.dec, 1); }
    else if (t.dataset.rm) cart.splice(+t.dataset.rm, 1);
    else return;
    save();
  });
  $('.sh-checkout', drawer).addEventListener('click', () => {
    $('.sh-note', drawer).textContent = 'Site de démonstration : le paiement est désactivé. Sur un vrai site, cette étape mène au paiement sécurisé (Stripe, PayPal…).';
  });

  function updateBadges() {
    const n = cart.reduce((s, l) => s + l.qty, 0);
    $$('[data-cart-count]').forEach((el) => { el.textContent = n; el.hidden = n === 0; });
    $$('[data-fav-count]').forEach((el) => { el.textContent = favs.size; el.hidden = favs.size === 0; });
  }

  /* ---------- Délégation globale ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-view],[data-fav],[data-add],[data-open-cart]');
    if (!t) return;
    if (t.dataset.view) view(t.dataset.view);
    else if (t.dataset.fav) toggleFav(t.dataset.fav);
    else if (t.dataset.add) { const p = byId[t.dataset.add]; p.sizes ? view(p.id) : add(p.id); }
    else if ('openCart' in t.dataset) open(drawer);
  });

  // Newsletter de démonstration
  $$('[data-newsletter]').forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault();
    f.reset();
    toast('Merci ! (démo : aucun e-mail n\'est envoyé)');
  }));

  render();
  renderCart();
  updateBadges();
})();
