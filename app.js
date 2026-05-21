// ============================================================
// ASN Agri / Asian Seeds — Challan System (frontend logic)
// ============================================================

// ── Supabase client ───────────────────────────────────────────
const sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON);

// ── In-memory cache ───────────────────────────────────────────
const state = {
  user: null,
  companies: [],       // [{id, code, name, ...}]
  distributors: [],    // [{id, name, city, manager, ...}]
  retailers: [],       // [{id, name, city, distributor_id}]
  products: [],        // [{id, company_id, name, packing_size_kg, rate_per_bag}]
  lots: [],            // [{id, product_id, lot_number, bags_available}]
  challans: [],        // recent challans for register
  selectedCompany: null,  // company code: 'ASN' or 'ASE'
  items: [],           // current batch line items
  handwrite: false,    // when true: skip lot picking + stock checks, print blank lot lines
};

// ── DOM helpers ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fmt = (d) => d ? new Date(d).toISOString().slice(0, 10) : '';
const fmtDMY = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};
const fmtIN = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ============================================================
// AUTH
// ============================================================
async function init() {
  // Check for existing session
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    state.user = session.user;
    await enterApp();
  } else {
    $('login-screen').style.display = 'flex';
    $('app').style.display = 'none';
  }

  // Listen for auth state changes
  sb.auth.onAuthStateChange(async (_event, session) => {
    if (session) {
      state.user = session.user;
      await enterApp();
    } else {
      state.user = null;
      $('login-screen').style.display = 'flex';
      $('app').style.display = 'none';
    }
  });
}

async function handleLogin(e) {
  e.preventDefault();
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const btn = $('login-btn');
  const msg = $('login-msg');

  btn.disabled = true;
  btn.textContent = 'Signing in…';
  msg.textContent = '';

  const { error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    msg.textContent = error.message;
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
  // Success path triggers onAuthStateChange → enterApp
}

async function handleLogout() {
  await sb.auth.signOut();
}

async function enterApp() {
  $('login-screen').style.display = 'none';
  $('app').style.display = 'block';
  $('user-chip').textContent = state.user.email;

  // Default DC date = today
  $('f-date').value = fmt(new Date());

  // Load all master data in parallel
  await loadAllData();

  // Setup searchable comboboxes once
  setupCombos();

  // First-time state: no company selected, no items
  state.items = [];
  renderItems();
  updateTotals();
  updateCompanyMeta();
}

// ============================================================
// DATA LOADING (master data)
// ============================================================
async function loadAllData() {
  const [c, d, r, p, l] = await Promise.all([
    sb.from('companies').select('*').order('code'),
    sb.from('distributors').select('*').order('name'),
    sb.from('retailers').select('*').order('name'),
    sb.from('products').select('*').order('name'),
    sb.from('product_lots').select('*').order('lot_number'),
  ]);

  if (c.error || d.error || r.error || p.error || l.error) {
    const err = c.error || d.error || r.error || p.error || l.error;
    toast('Database error: ' + err.message, true);
    return;
  }

  state.companies    = c.data || [];
  state.distributors = d.data || [];
  state.retailers    = r.data || [];
  state.products     = p.data || [];
  state.lots         = l.data || [];

  updateCompanyMeta();
}

// ============================================================
// SEARCHABLE COMBOBOXES (distributor + retailer)
// ============================================================
function setupCombos() {
  setupCombo({
    inputId:  'f-dist-input',
    hiddenId: 'f-dist',
    listId:   'f-dist-list',
    source:   () => state.distributors,
    onPick:   () => {
      // when distributor changes, reset retailer + enable retailer combo
      const retInput = $('f-ret-input');
      retInput.value = '';
      retInput.classList.remove('has-selection');
      retInput.disabled = false;
      retInput.placeholder = 'Type to search retailers…';
      $('f-ret').value = '';
    },
  });
  setupCombo({
    inputId:  'f-ret-input',
    hiddenId: 'f-ret',
    listId:   'f-ret-list',
    source:   () => {
      const distId = $('f-dist').value;
      if (!distId) return [];
      return state.retailers.filter(r => r.distributor_id === distId);
    },
  });
}

function setupCombo({ inputId, hiddenId, listId, source, onPick }) {
  const input  = $(inputId);
  const hidden = $(hiddenId);
  const list   = $(listId);
  let highlight = -1;

  function render(query = '') {
    const items = source();
    const q = query.trim().toLowerCase();
    // Match: starts-with first, then contains (so typing "sai" surfaces "Sairam" before "Vaishali")
    const startsWith = items.filter(x => x.name.toLowerCase().startsWith(q));
    const contains   = items.filter(x => !x.name.toLowerCase().startsWith(q) && x.name.toLowerCase().includes(q));
    const matches = q ? [...startsWith, ...contains] : items;

    if (matches.length === 0) {
      list.innerHTML = '<div class="combo-item empty">No matches</div>';
    } else {
      list.innerHTML = matches.slice(0, 50).map((x, i) =>
        `<div class="combo-item" data-id="${x.id}" data-name="${escapeAttr(x.name)}">
          <span>${x.name}</span><span class="ci-meta">${x.city || ''}</span>
        </div>`
      ).join('');
    }
    highlight = -1;
    list.classList.add('open');
  }

  function pick(id, name) {
    hidden.value = id;
    input.value = name;
    input.classList.add('has-selection');
    list.classList.remove('open');
    if (onPick) onPick();
  }

  input.addEventListener('focus', () => {
    render(input.value);
  });
  input.addEventListener('input', () => {
    // typing clears any previous selection
    hidden.value = '';
    input.classList.remove('has-selection');
    render(input.value);
  });
  input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('.combo-item:not(.empty)');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight = Math.min(items.length - 1, highlight + 1);
      items.forEach((el, i) => el.classList.toggle('highlighted', i === highlight));
      if (items[highlight]) items[highlight].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight = Math.max(0, highlight - 1);
      items.forEach((el, i) => el.classList.toggle('highlighted', i === highlight));
      if (items[highlight]) items[highlight].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = items[highlight >= 0 ? highlight : 0];
      if (target) pick(target.dataset.id, target.dataset.name);
    } else if (e.key === 'Escape') {
      list.classList.remove('open');
    }
  });
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.combo-item');
    if (!item || item.classList.contains('empty')) return;
    pick(item.dataset.id, item.dataset.name);
  });
  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) {
      list.classList.remove('open');
    }
  });
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================
// COMPANY SELECTOR
// ============================================================
function selectCompany(code) {
  state.selectedCompany = code;
  document.querySelectorAll('.co-pill').forEach(el => {
    el.classList.toggle('selected', el.dataset.co === code);
  });
  // Reset items when switching company (products are company-scoped)
  state.items = [];
  renderItems();
  updateTotals();
}

function getCurrentCompany() {
  return state.companies.find(c => c.code === state.selectedCompany);
}

function updateCompanyMeta() {
  for (const code of ['ASN', 'ASIAN']) {
    const co = state.companies.find(c => c.code === code);
    if (!co) continue;
    const prodIds = state.products.filter(p => p.company_id === co.id).map(p => p.id);
    const totalBags = state.lots
      .filter(l => prodIds.includes(l.product_id) && l.active !== false)
      .reduce((sum, l) => sum + (l.bags_available || 0), 0);
    const el = $('co-meta-' + code);
    if (el) el.textContent = `${totalBags.toLocaleString('en-IN')} bags ready`;
  }
}

// ============================================================
// LINE ITEMS (New Batch)
// Each item = one product group with one or more lot allocations.
// Shape: { id, product_id, packing_size_kg, rate_per_bag, lots: [{ id, lot_id, bags, qty_qtl }] }
// ============================================================
function onHandwriteToggle(checked) {
  state.handwrite = !!checked;
  // Re-render items so lot rows show/hide, and recompute totals.
  renderItems();
  updateTotals();
}

function addItem() {
  if (!state.selectedCompany) {
    toast('Pick a company first', true);
    return;
  }
  state.items.push({
    id: Math.random().toString(36).slice(2),
    product_id: '',
    packing_size_kg: '',
    rate_per_bag: 0,
    lots: [makeLot()],
  });
  renderItems();
}

function makeLot() {
  return {
    id: Math.random().toString(36).slice(2),
    lot_id: '',
    bags: '',
    qty_qtl: '',
  };
}

function addLotToItem(itemId) {
  const it = state.items.find(i => i.id === itemId);
  if (!it) return;
  if (!it.product_id) { toast('Pick a product first', true); return; }
  it.lots.push(makeLot());
  renderItems();
}

function delLot(itemId, lotRowId) {
  const it = state.items.find(i => i.id === itemId);
  if (!it) return;
  if (it.lots.length <= 1) {
    toast('At least one lot required \u2014 remove the whole product instead', true);
    return;
  }
  it.lots = it.lots.filter(l => l.id !== lotRowId);
  renderItems();
  updateTotals();
}

function delItem(id) {
  state.items = state.items.filter(i => i.id !== id);
  renderItems();
  updateTotals();
}

function renderItems() {
  const tbody = $('items-tbody');
  if (state.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted);font-size:12px">
      ${state.selectedCompany ? 'No items yet. Click "+ Add Item" to start.' : 'Select a company above to begin.'}
    </td></tr>`;
    return;
  }

  const co = getCurrentCompany();
  const companyProducts = co ? state.products.filter(p => p.company_id === co.id) : [];

  // Build product groups. Each group is a header row (product picker + meta)
  // followed by 1..N lot rows.
  tbody.innerHTML = state.items.map((it, idx) => {
    const productOptions = '<option value="">— pick product —</option>' +
      companyProducts.map(p => `<option value="${p.id}" ${it.product_id === p.id ? 'selected' : ''}>${p.name}</option>`).join('');

    // ── HANDWRITE MODE ──────────────────────────────────────────
    // No lot picking, no stock. One row per product: product + pack + bags + qty.
    // We keep the value in it.lots[0] (lot_id stays blank) so the rest of the
    // data pipeline (totals, save, buildChallanData) works unchanged.
    if (state.handwrite) {
      if (!it.lots || it.lots.length === 0) it.lots = [makeLot()];
      if (it.lots.length > 1) it.lots = [it.lots[0]];  // collapse to one
      const hl = it.lots[0];
      return `<tr data-item="${it.id}" class="product-row">
        <td style="text-align:center;color:var(--ink);font-size:13px;font-weight:600">${idx + 1}</td>
        <td><select onchange="onProductPick('${it.id}', this.value)">${productOptions}</select></td>
        <td style="font-size:11px;color:var(--muted);font-style:italic">handwritten on print</td>
        <td><input type="number" value="${it.packing_size_kg}" readonly tabindex="-1" style="background:var(--line-soft);color:var(--ink-soft);cursor:not-allowed" title="Set by product master"></td>
        <td><input type="number" step="1" min="0" value="${hl.bags}" data-item="${it.id}" data-lot="${hl.id}" data-field="bags" class="num-wheel" oninput="onLotBagsChange('${it.id}', '${hl.id}', this.value)"></td>
        <td><input type="number" step="0.01" min="0" value="${hl.qty_qtl}" data-item="${it.id}" data-lot="${hl.id}" data-field="qty_qtl" class="num-wheel" oninput="onLotQtyChange('${it.id}', '${hl.id}', this.value)"></td>
        <td><button class="btn btn-sm btn-icon" onclick="delItem('${it.id}')" title="Remove product">×</button></td>
      </tr>`;
    }
    // ── end handwrite mode ──────────────────────────────────────

    const productLots = it.product_id
      ? state.lots.filter(l => l.product_id === it.product_id && l.active !== false)
      : [];

    // Group total bags + qty across all lots in this item
    const groupBags = it.lots.reduce((s, l) => s + (Number(l.bags) || 0), 0);
    const groupQty  = it.lots.reduce((s, l) => s + (Number(l.qty_qtl) || 0), 0);

    // Lots already chosen in this item (to disable duplicates in the dropdown)
    const usedLotIds = new Set(it.lots.map(l => l.lot_id).filter(Boolean));

    const lotRows = it.lots.map((lot, lotIdx) => {
      const selectedLot = productLots.find(l => l.id === lot.lot_id);
      const overflow = selectedLot && Number(lot.bags) > selectedLot.bags_available;

      const lotOptions = '<option value="">— pick lot —</option>' +
        productLots.map(l => {
          const dup = usedLotIds.has(l.id) && l.id !== lot.lot_id;
          return `<option value="${l.id}" ${lot.lot_id === l.id ? 'selected' : ''} ${dup ? 'disabled' : ''}>
            ${l.lot_number} (${l.bags_available} avail)${dup ? ' \u2014 already used' : ''}
          </option>`;
        }).join('');

      return `<tr data-row="${lot.id}" data-parent="${it.id}" class="lot-row">
        <td></td>
        <td style="padding-left:24px;color:var(--muted);font-size:11px">↳ lot ${lotIdx + 1}</td>
        <td>
          <select onchange="updateLot('${it.id}', '${lot.id}', 'lot_id', this.value)">${lotOptions}</select>
          ${selectedLot ? `<div class="stock-hint ${overflow ? 'stock-warn' : ''}">${selectedLot.bags_available} in stock${overflow ? ' — OVER!' : ''}</div>` : ''}
        </td>
        <td></td>
        <td><input type="number" step="1" min="0" value="${lot.bags}" data-item="${it.id}" data-lot="${lot.id}" data-field="bags" class="num-wheel" oninput="onLotBagsChange('${it.id}', '${lot.id}', this.value)"></td>
        <td><input type="number" step="0.01" min="0" value="${lot.qty_qtl}" data-item="${it.id}" data-lot="${lot.id}" data-field="qty_qtl" class="num-wheel" oninput="onLotQtyChange('${it.id}', '${lot.id}', this.value)"></td>
        <td><button class="btn btn-sm btn-icon" onclick="delLot('${it.id}', '${lot.id}')" title="Remove this lot">×</button></td>
      </tr>`;
    }).join('');

    return `<tr data-item="${it.id}" class="product-row">
      <td style="text-align:center;color:var(--ink);font-size:13px;font-weight:600">${idx + 1}</td>
      <td><select onchange="onProductPick('${it.id}', this.value)">${productOptions}</select></td>
      <td style="font-size:11px;color:var(--muted)">${it.lots.length > 1 ? it.lots.length + ' lots' : '\u2014'}</td>
      <td><input type="number" value="${it.packing_size_kg}" readonly tabindex="-1" style="background:var(--line-soft);color:var(--ink-soft);cursor:not-allowed" title="Set by product master"></td>
      <td style="font-weight:600">${groupBags || ''}</td>
      <td style="font-weight:600">${groupQty ? groupQty.toFixed(2) : ''}</td>
      <td><button class="btn btn-sm btn-icon" onclick="delItem('${it.id}')" title="Remove product">×</button></td>
    </tr>${lotRows}
    <tr class="lot-row-add"><td></td><td colspan="6" style="padding-top:0">
      <button class="btn btn-sm" onclick="addLotToItem('${it.id}')" ${!it.product_id ? 'disabled' : ''}>+ Add another lot</button>
    </td></tr>`;
  }).join('');
}

function onProductPick(itemId, productId) {
  const it = state.items.find(i => i.id === itemId);
  if (!it) return;
  it.product_id = productId;
  const product = state.products.find(p => p.id === productId);
  if (product) {
    it.packing_size_kg = product.packing_size_kg;
    it.rate_per_bag = product.rate_per_bag;
  } else {
    it.packing_size_kg = '';
    it.rate_per_bag = 0;
  }
  // Clear any lot allocations since product changed
  it.lots = [makeLot()];
  renderItems();
  updateTotals();
}

function updateLot(itemId, lotRowId, field, value) {
  const it = state.items.find(i => i.id === itemId);
  if (!it) return;
  const lot = it.lots.find(l => l.id === lotRowId);
  if (!lot) return;
  lot[field] = value;
  if (field === 'lot_id') {
    // Reset bags/qty when picking a different lot
    lot.bags = '';
    lot.qty_qtl = '';
  }
  renderItems();
  updateTotals();
}

// Helper: find a lot input in the DOM by its row + field
function siblingLotInput(itemId, lotRowId, otherField) {
  return document.querySelector(`input.num-wheel[data-item="${itemId}"][data-lot="${lotRowId}"][data-field="${otherField}"]`);
}

function refreshLotStockHint(itemId, lotRowId) {
  const it = state.items.find(i => i.id === itemId);
  if (!it) return;
  const lot = it.lots.find(l => l.id === lotRowId);
  if (!lot) return;
  const stock = state.lots.find(s => s.id === lot.lot_id);
  if (!stock) return;
  const cell = document.querySelector(`tr[data-row="${lotRowId}"] .stock-hint`);
  if (!cell) return;
  const overflow = Number(lot.bags) > stock.bags_available;
  cell.className = 'stock-hint' + (overflow ? ' stock-warn' : '');
  cell.textContent = `${stock.bags_available} in stock${overflow ? ' — OVER!' : ''}`;
}

// Recompute group totals in-place (no re-render) so the header row stays in sync as user types
function refreshGroupTotals(itemId) {
  // In handwrite mode the bags/qty cells ARE the input cells (no separate header
  // row), so writing textContent would wipe the input the user is typing in. Skip.
  if (state.handwrite) return;
  const it = state.items.find(i => i.id === itemId);
  if (!it) return;
  const groupBags = it.lots.reduce((s, l) => s + (Number(l.bags) || 0), 0);
  const groupQty  = it.lots.reduce((s, l) => s + (Number(l.qty_qtl) || 0), 0);
  const headerRow = document.querySelector(`tr.product-row[data-item="${itemId}"]`);
  if (!headerRow) return;
  const cells = headerRow.querySelectorAll('td');
  // cells: [0]=#, [1]=product, [2]=lot count, [3]=pack, [4]=bags, [5]=qty, [6]=delete
  if (cells[4]) cells[4].textContent = groupBags || '';
  if (cells[5]) cells[5].textContent = groupQty ? groupQty.toFixed(2) : '';
}

function onLotBagsChange(itemId, lotRowId, value) {
  const it = state.items.find(i => i.id === itemId);
  if (!it) return;
  const lot = it.lots.find(l => l.id === lotRowId);
  if (!lot) return;
  lot.bags = value;
  const bags = Number(value) || 0;
  const pack = Number(it.packing_size_kg) || 0;
  lot.qty_qtl = ((bags * pack) / 100).toFixed(2);
  const qtyEl = siblingLotInput(itemId, lotRowId, 'qty_qtl');
  if (qtyEl) qtyEl.value = lot.qty_qtl;
  refreshLotStockHint(itemId, lotRowId);
  refreshGroupTotals(itemId);
  updateTotals();
}

function onLotQtyChange(itemId, lotRowId, value) {
  const it = state.items.find(i => i.id === itemId);
  if (!it) return;
  const lot = it.lots.find(l => l.id === lotRowId);
  if (!lot) return;
  lot.qty_qtl = value;
  const qty = Number(value) || 0;
  const pack = Number(it.packing_size_kg) || 0;
  if (pack > 0) {
    lot.bags = Math.round((qty * 100) / pack);
  }
  const bagsEl = siblingLotInput(itemId, lotRowId, 'bags');
  if (bagsEl) bagsEl.value = lot.bags;
  refreshLotStockHint(itemId, lotRowId);
  refreshGroupTotals(itemId);
  updateTotals();
}

// Global wheel handler: scroll up/down on a focused number input → increment/decrement.
// Only fires when the input is focused, so accidental page scrolls don't change values.
document.addEventListener('wheel', function(e) {
  const el = document.activeElement;
  if (!el || !el.classList.contains('num-wheel')) return;
  if (el !== e.target && !el.contains(e.target)) return;

  e.preventDefault();
  const itemId = el.dataset.item;
  const lotRowId = el.dataset.lot;
  const field = el.dataset.field;
  const step = field === 'bags' ? 1 : 0.5;
  const direction = e.deltaY < 0 ? 1 : -1;
  const current = Number(el.value) || 0;
  const newVal = Math.max(0, current + (step * direction));
  const rounded = field === 'bags' ? Math.round(newVal) : Math.round(newVal * 100) / 100;

  el.value = rounded;
  if (field === 'bags') {
    onLotBagsChange(itemId, lotRowId, rounded);
  } else {
    onLotQtyChange(itemId, lotRowId, rounded);
  }
}, { passive: false });

function updateTotals() {
  let totalBags = 0, totalQty = 0, totalVal = 0;
  for (const it of state.items) {
    const rate = Number(it.rate_per_bag) || 0;
    for (const lot of it.lots) {
      const bags = Number(lot.bags) || 0;
      const qty  = Number(lot.qty_qtl) || 0;
      totalBags += bags;
      totalQty  += qty;
      totalVal  += bags * rate;
    }
  }
  $('tot-bags').textContent = totalBags.toLocaleString('en-IN');
  $('tot-qty').textContent = totalQty.toFixed(2);
  $('tot-val').textContent = fmtIN(totalVal);
}

function clearBatch() {
  if (!confirm('Clear all items and party info?')) return;
  // Reset distributor combo
  $('f-dist').value = '';
  $('f-dist-input').value = '';
  $('f-dist-input').classList.remove('has-selection');
  // Reset retailer combo (and disable until distributor picked)
  $('f-ret').value = '';
  $('f-ret-input').value = '';
  $('f-ret-input').classList.remove('has-selection');
  $('f-ret-input').disabled = true;
  $('f-ret-input').placeholder = 'Select distributor first…';
  // Other fields
  $('f-lorry').value = '';
  $('f-transport').value = 'Singh Golden Transport';
  state.items = [];
  renderItems();
  updateTotals();
}

// ============================================================
// VALIDATION & SAVE
// ============================================================
function validateBatch() {
  const errs = [];
  if (!state.selectedCompany) errs.push('Pick a company.');
  if (!$('f-dist').value)     errs.push('Pick a distributor.');
  if (!$('f-ret').value)      errs.push('Pick a retailer.');
  if (state.items.length === 0) errs.push('Add at least one item.');

  // Aggregate bags per lot across ALL items (a lot might be split across rows accidentally)
  // — actually within one item we disable duplicate lots in the dropdown, but across items
  // the same lot could theoretically appear. Sum to check total stock.
  const lotDemand = new Map(); // lot_id -> total bags requested

  for (const [i, it] of state.items.entries()) {
    const n = i + 1;
    if (!it.product_id) { errs.push(`Item ${n}: pick a product`); continue; }
    if (!(Number(it.packing_size_kg) > 0)) errs.push(`Item ${n}: packing size > 0`);

    // Handwrite mode: only need product + bags. No lot, no stock check.
    if (state.handwrite) {
      const hl = (it.lots && it.lots[0]) || null;
      if (!hl || !(Number(hl.bags) > 0)) errs.push(`Item ${n}: bags > 0`);
      continue;
    }

    if (!it.lots || it.lots.length === 0) { errs.push(`Item ${n}: add at least one lot`); continue; }

    for (const [j, lot] of it.lots.entries()) {
      const ln = j + 1;
      if (!lot.lot_id)               errs.push(`Item ${n} · lot ${ln}: pick a lot`);
      if (!(Number(lot.bags) > 0))   errs.push(`Item ${n} · lot ${ln}: bags > 0`);
      if (!(Number(lot.qty_qtl) > 0)) errs.push(`Item ${n} · lot ${ln}: qty > 0`);
      if (lot.lot_id) {
        lotDemand.set(lot.lot_id, (lotDemand.get(lot.lot_id) || 0) + (Number(lot.bags) || 0));
      }
    }
  }

  // Stock check on aggregated demand
  for (const [lotId, demand] of lotDemand.entries()) {
    const stock = state.lots.find(l => l.id === lotId);
    if (stock && demand > stock.bags_available) {
      errs.push(`Lot ${stock.lot_number}: requested ${demand} bags, only ${stock.bags_available} available`);
    }
  }
  return errs;
}

function buildChallanData() {
  const co = getCurrentCompany();
  const dist = state.distributors.find(d => d.id === $('f-dist').value);
  const ret = state.retailers.find(r => r.id === $('f-ret').value);

  return {
    company: co,
    distributor: dist,
    retailer: ret,
    dc_date: $('f-date').value,
    lorry_no: $('f-lorry').value.trim(),
    transport: $('f-transport').value.trim(),
    freight_status: $('f-freight').value,
    handwrite: state.handwrite,
    // Each item: a product group with one or more lot allocations.
    items: state.items.map((it, idx) => {
      const product = state.products.find(p => p.id === it.product_id);
      return {
        position: idx + 1,
        product_id: it.product_id,
        product_name: product?.name || '',
        packing_size_kg: Number(it.packing_size_kg),
        rate_per_bag: Number(it.rate_per_bag) || 0,
        lots: it.lots.map(lot => {
          const stock = state.lots.find(l => l.id === lot.lot_id);
          return {
            lot_id: lot.lot_id,
            lot_number: stock?.lot_number || '',
            bags: Number(lot.bags),
            qty_qtl: Number(lot.qty_qtl),
          };
        }),
      };
    }),
    total_bags: state.items.reduce((s, it) =>
      s + it.lots.reduce((ss, l) => ss + (Number(l.bags) || 0), 0), 0),
    total_qty_qtl: state.items.reduce((s, it) =>
      s + it.lots.reduce((ss, l) => ss + (Number(l.qty_qtl) || 0), 0), 0),
    total_value: state.items.reduce((s, it) => {
      const rate = Number(it.rate_per_bag) || 0;
      return s + it.lots.reduce((ss, l) => ss + (Number(l.bags) || 0) * rate, 0);
    }, 0),
  };
}

async function saveChallan() {
  const errs = validateBatch();
  if (errs.length) {
    toast(errs[0], true);
    return;
  }

  const btn = $('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  // Wrap any promise so a stuck Supabase call can't hang the UI forever.
  const withTimeout = (promise, label, ms = 15000) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms/1000}s — check network / Supabase RLS`)), ms)
      ),
    ]);

  try {
    const d = buildChallanData();
    console.log('[save] start', d);

    // 1) Get next DC number for this company (atomic increment)
    console.log('[save] 1/4 next_dc_number…');
    const { data: nextDc, error: dcErr } = await withTimeout(
      sb.rpc('next_dc_number', { p_company_id: d.company.id }), 'Get DC number');
    if (dcErr) throw dcErr;
    console.log('[save] got DC number', nextDc);

    // 2) Insert challan header
    console.log('[save] 2/4 insert challan header…');
    const { data: ch, error: chErr } = await withTimeout(
      sb.from('challans').insert({
        dc_number:     nextDc,
        company_id:    d.company.id,
        dc_date:       d.dc_date,
        distributor_id: d.distributor.id,
        retailer_id:   d.retailer.id,
        lorry_no:      d.lorry_no || null,
        transport:     d.transport || null,
        freight_status: d.freight_status,
        total_bags:    d.total_bags,
        total_qty_qtl: d.total_qty_qtl,
        total_value:   d.total_value,
        created_by:    state.user.id,
      }).select().single(), 'Insert challan');
    if (chErr) throw chErr;
    console.log('[save] challan inserted', ch.id);

    // 3) Insert challan items — one row per lot allocation (flattened from groups)
    //    DB schema unchanged; multi-lot is purely a presentation concept.
    let position = 1;
    const itemRows = [];
    for (const it of d.items) {
      for (const lot of it.lots) {
        itemRows.push({
          challan_id:      ch.id,
          position:        position++,
          product_id:      it.product_id,
          product_name:    it.product_name,
          lot_id:          d.handwrite ? null : (lot.lot_id || null),
          lot_number:      d.handwrite ? '' : lot.lot_number,
          packing_size_kg: Number(it.packing_size_kg),
          bags:            Number(lot.bags),
          qty_qtl:         Number(lot.qty_qtl),
          rate_per_bag:    Number(it.rate_per_bag) || 0,
          line_value:      Number(lot.bags) * (Number(it.rate_per_bag) || 0),
        });
      }
    }
    console.log('[save] 3/4 insert challan_items…', itemRows);
    const { error: itErr } = await withTimeout(
      sb.from('challan_items').insert(itemRows), 'Insert items');
    if (itErr) throw itErr;
    console.log('[save] items inserted');

    // 4) Deduct stock per lot (atomic, blocks if insufficient).
    //    Skipped entirely in handwrite mode — no lots are allocated there.
    if (!d.handwrite) {
      console.log('[save] 4/4 deduct stock…');
      const deductByLot = new Map();
      for (const it of d.items) {
        for (const lot of it.lots) {
          deductByLot.set(lot.lot_id, (deductByLot.get(lot.lot_id) || 0) + Number(lot.bags));
        }
      }
      for (const [lotId, bags] of deductByLot.entries()) {
        const { error: allocErr } = await withTimeout(
          sb.rpc('allocate_stock', { p_lot_id: lotId, p_bags: bags }), 'Deduct stock');
        if (allocErr) throw allocErr;
      }
    } else {
      console.log('[save] 4/4 stock deduction skipped (handwrite)');
    }

    // 5) Refresh local cache (lots changed, challans changed)
    console.log('[save] refreshing data…');
    await withTimeout(loadAllData(), 'Reload data', 20000);

    // 6) Show the challan
    showChallanPreview({ ...d, dc_number: nextDc });

    toast(`DC ${d.company.code}-${nextDc} saved!`);
    console.log('[save] done');

    // 7) Clear for next batch
    state.items = [];
    renderItems();
    updateTotals();

  } catch (e) {
    console.error('[save] FAILED:', e);
    toast('Save failed: ' + (e.message || e), true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & Generate DC';
  }
}

// ============================================================
// CHALLAN PREVIEW (rendered HTML for both modal & PDF)
// ============================================================
function previewChallan() {
  const errs = validateBatch();
  if (errs.length) {
    toast(errs[0], true);
    return;
  }
  const d = buildChallanData();
  // Use a placeholder DC number for preview
  d.dc_number = '(unsaved)';
  showChallanPreview(d);
}

function showChallanPreview(d) {
  const html = buildChallanHTML(d);
  $('modal-body').innerHTML = html;
  $('preview-modal').classList.add('open');
}

function closeModal() {
  $('preview-modal').classList.remove('open');
}

function n2w(num) {
  // Convert number to words (Indian numbering)
  if (!num || num === 0) return 'Zero Rupees Only';
  const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function two(n) {
    if (n < 20) return a[n];
    return b[Math.floor(n/10)] + (n%10 ? ' ' + a[n%10] : '');
  }
  function three(n) {
    if (n >= 100) return a[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + two(n%100) : '');
    return two(n);
  }
  let n = Math.floor(num);
  let out = '';
  if (n >= 10000000) { out += three(Math.floor(n/10000000)) + ' Crore '; n %= 10000000; }
  if (n >= 100000)   { out += three(Math.floor(n/100000)) + ' Lakh '; n %= 100000; }
  if (n >= 1000)     { out += three(Math.floor(n/1000)) + ' Thousand '; n %= 1000; }
  if (n > 0)         { out += three(n); }
  return out.trim() + ' Rupees Only';
}

function buildChallanHTML(d) {
  const co = d.company;
  const isAsian = co.code === 'ASIAN' || co.code === 'ASE'; // tolerate legacy ASE rows

  // Display name for the item list: strip the trailing stage label
  // ("Certified Seeds", "Research Seeds", etc.) without touching stored data.
  // "SOYBEAN SEEDS Game Changer Certified Seeds" -> "SOYBEAN SEEDS Game Changer"
  const displayName = (name) =>
    (name || '').replace(/\s+(Certified|Research|Foundation|Truthful(?:ly Labelled)?)\s+Seeds\s*$/i, '').trim();

  // d.items now: [{ product_name, packing_size_kg, lots: [{ lot_number, bags, qty_qtl }, ...] }]
  // Render: ONE merged row per product, with lot numbers stacked inside the Lot No. cell,
  // bag totals/qty stacked too, plus a Total line if multi-lot.
  let totalLotLines = 0;
  // Handwrite mode: divide a fixed writing area among the products so the
  // item rows fill the page (no stray empty rows, no bottom gap).
  const HW_TOTAL_WRITE_PX = 560;   // total writing height to spread across products
  const hwCount = Math.max(1, d.items.length);
  const hwPerRow = Math.floor(HW_TOTAL_WRITE_PX / hwCount);
  const itemRows = d.items.map((it, i) => {
    // ── HANDWRITE MODE: tall open cell, no ruled lines, fills the page ──
    if (d.handwrite) {
      const groupBags = it.lots.reduce((s, l) => s + Number(l.bags || 0), 0);
      const groupQty  = it.lots.reduce((s, l) => s + Number(l.qty_qtl || 0), 0);
      return `<tr>
        <td style="text-align:center;vertical-align:top;padding-top:8px">${i + 1}</td>
        <td style="vertical-align:top;padding-top:8px;font-size:13.5px;font-weight:600">${displayName(it.product_name)}</td>
        <td style="vertical-align:top"><div style="height:${hwPerRow}px"></div></td>
        <td style="text-align:center;vertical-align:top;padding-top:8px">${it.packing_size_kg}</td>
        <td style="text-align:center;vertical-align:top;padding-top:8px;font-weight:700">${groupBags || ''}</td>
        <td style="text-align:center;vertical-align:top;padding-top:8px;font-weight:700">${groupQty ? groupQty.toFixed(2) : ''}</td>
      </tr>`;
    }
    // ── end handwrite mode ──

    const isMulti = it.lots.length > 1;
    const lotNumbersHtml = it.lots.map(l => l.lot_number).join('<br>');
    const bagsHtml = it.lots.map(l => l.bags).join('<br>');
    const qtyHtml  = it.lots.map(l => Number(l.qty_qtl).toFixed(2)).join('<br>');

    const groupBags = it.lots.reduce((s, l) => s + Number(l.bags || 0), 0);
    const groupQty  = it.lots.reduce((s, l) => s + Number(l.qty_qtl || 0), 0);

    totalLotLines += it.lots.length + (isMulti ? 1 : 0); // approx row height for empties

    const totalLine = isMulti
      ? `<div style="margin-top:3px;border-top:1px solid #000;padding-top:2px;font-weight:700">
           Total: ${groupBags} bags / ${groupQty.toFixed(2)} qtl
         </div>`
      : '';

    return `<tr>
      <td style="text-align:center;vertical-align:top">${i + 1}</td>
      <td style="vertical-align:top;font-size:13.5px;font-weight:600">${displayName(it.product_name)}${isMulti ? `<div style="font-size:9px;color:#555;margin-top:2px">(across ${it.lots.length} lots)</div>` : ''}</td>
      <td style="font-family:'Inter',sans-serif;font-size:11px;line-height:1.5;vertical-align:top">${lotNumbersHtml}</td>
      <td style="text-align:center;vertical-align:top">${it.packing_size_kg}</td>
      <td style="text-align:center;line-height:1.5;vertical-align:top">${bagsHtml}${totalLine ? `<div style="margin-top:3px;border-top:1px solid #000;padding-top:2px;font-weight:700">${groupBags}</div>` : ''}</td>
      <td style="text-align:center;line-height:1.5;vertical-align:top">${qtyHtml}${totalLine ? `<div style="margin-top:3px;border-top:1px solid #000;padding-top:2px;font-weight:700">${groupQty.toFixed(2)}</div>` : ''}</td>
    </tr>`;
  }).join('');

  // No ruled empty filler rows: they just add ugly repeated horizontal lines.
  // Instead, the single full-height `cp-spacer` row (added below) soaks up all
  // the leftover height as ONE clean blank band under the populated varieties,
  // so the only horizontal divisions are the lines between real variety rows.
  const emptyHtml = '';

  const logoHtml = co.logo_url
    ? `<img src="${co.logo_url}" alt="${co.name}">`
    : `<div style="font-family:Fraunces,serif;font-size:24px;font-weight:700;opacity:.3">${co.code}</div>`;

  return `<div class="cp" id="cp-target">
    ${isAsian ? '<div class="cp-shri">!! Shri !!</div>' : ''}
    <div class="cp-head">
      <div class="cp-logo">${logoHtml}</div>
      <div class="cp-co">
        <div class="cn">${co.name}</div>
        ${co.tagline ? `<div class="ct-line">${co.tagline}</div>` : ''}
        ${co.office_addr ? `<div class="ca"><strong>Off.:</strong> ${co.office_addr}</div>` : ''}
        <div class="ca"><strong>Plant:</strong> ${co.plant_addr}</div>
        <div class="cg">${co.gstin ? 'GSTIN: ' + co.gstin + ' &nbsp; | &nbsp;' : ''}${co.cin ? 'CIN: ' + co.cin : ''}</div>
        <div class="cg">Seed Lic. No.: ${co.lic1 || '—'}${co.lic2 ? ' &nbsp; | &nbsp; ' + co.lic2 : ''}</div>
        <div class="ca">${co.email ? 'Email: ' + co.email + ' &nbsp; &nbsp;' : ''}${co.phone ? 'Ph: ' + co.phone : ''}</div>
      </div>
      <div class="cp-right">
        <div class="ct">Delivery Challan / Transit Invoice</div>
      </div>
    </div>

    <div class="cp-refs">
      <div class="cp-ref"><div class="rl">DC No.</div><div class="rv">${d.dc_number}</div></div>
      <div class="cp-ref"><div class="rl">DC Date</div><div class="rv">${fmtDMY(d.dc_date)}</div></div>
      <div class="cp-ref"><div class="rl">Lorry No.</div><div class="rv">${d.lorry_no || '—'}</div></div>
      <div class="cp-ref"><div class="rl">Transport</div><div class="rv">${d.transport || '—'}</div></div>
    </div>

    <div class="cp-bil">
      <div class="cp-box">
        <div class="bt">${isAsian ? 'Party TIN No.' : 'Party GSTIN'}: ${d.distributor.gstin || '—'}</div>
        <div class="bt" style="margin-top:4px"><strong>M/s (Bill To):</strong></div>
        <div class="bv">${d.distributor.name}</div>
        <div class="bs">${d.distributor.address || ''}</div>
        <div class="bx">${d.distributor.city || ''}</div>
      </div>
      <div class="cp-box">
        <div class="bt"><strong>Delivery To:</strong></div>
        <div class="bv">${d.retailer.name}</div>
        <div class="bs">${d.retailer.address || ''}</div>
        <div class="bx">${d.retailer.city || ''}${d.retailer.phone ? ' &nbsp; · &nbsp; Ph: ' + d.retailer.phone : ''}</div>
      </div>
    </div>

    <div class="cp-tablewrap">
    <table class="cp-it">
      <thead>
        <tr>
          <th style="width:30px">No.</th>
          <th>Crop / Variety</th>
          <th style="width:140px">Lot No.</th>
          <th style="width:60px">Pack (kg)</th>
          <th style="width:60px">No. of Bags</th>
          <th style="width:70px">Qty (Qtl)</th>
        </tr>
      </thead>
      <tbody>${itemRows}${emptyHtml}${d.handwrite ? '' : '<tr class="cp-spacer"><td></td><td></td><td></td><td></td><td></td><td></td></tr>'}</tbody>
      <tfoot>
        <tr class="tr-tot">
          <td colspan="3" style="text-align:right;padding-right:10px">Freight Rs. _____________ ${d.freight_status}</td>
          <td style="text-align:center">TOTAL</td>
          <td style="text-align:center">${d.total_bags}</td>
          <td style="text-align:center">${Number(d.total_qty_qtl).toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
    </div>

    <div class="cp-footer">
    <div class="cp-estrow">
      <div class="cp-est" style="flex:1">
        <div class="el">Estimated Value Rs.</div>
        <div class="ev">${fmtIN(d.total_value)}</div>
      </div>
      <div class="cp-est" style="flex:2">
        <div class="el">In Words</div>
        <div class="ev" style="font-size:12px">${n2w(d.total_value)}</div>
      </div>
    </div>

    <div class="cp-cert">✦ CERTIFIED / TRUTHFULLY LABELLED SEEDS — TREATED WITH POISON ✦</div>

    <div class="cp-terms">
      <div>• Certified that Goods supplied to transporters are in good condition &amp; damage if any during transit will be on buyer's account.</div>
      <div>• Goods once sold will not be accepted back.</div>
      <div>• Seeds for Agricultural use only.</div>
      <div>• E-way bill is not required as per GST (Rule 138 (14)) Chapter of Heading or Tariff 1209, 12, 0909 All Goods of Seed Quality.</div>
      <div>• E-Invoice is not required on all goods of Seed Quality (Exempted) as per Serial No. 59 of Notification No. 2/2017 dated 28.06.2017.</div>
      <div>• All Subject to INDORE Jurisdiction.</div>
    </div>

    <div class="cp-sign">
      <div class="cp-sb">Customer's Signature</div>
      <div class="cp-sb">Driver Signature</div>
      <div class="cp-sb">
        For : ${co.name}<br>
        <span class="sb-sub">Authorised Signatory</span>
      </div>
    </div>
    </div>
  </div>`;
}

// ============================================================
// PDF DOWNLOAD
// ============================================================
async function downloadPDF() {
  const target = document.getElementById('cp-target');
  if (!target) { toast('Nothing to download', true); return; }

  toast('Generating PDF…');
  try {
    const canvas = await html2canvas(target, { scale: 2, backgroundColor: '#fff' });
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW - 20;
    const imgH = (canvas.height * imgW) / canvas.width;
    const finalH = Math.min(imgH, pageH - 20);
    pdf.addImage(imgData, 'JPEG', 10, 10, imgW, finalH);

    // Find a sensible filename
    const co = getCurrentCompany() || state.companies.find(c => c.id);
    const dcText = target.querySelector('.cp-refs .rv')?.textContent || 'DC';
    pdf.save(`${dcText}.pdf`);
  } catch (e) {
    toast('PDF error: ' + e.message, true);
  }
}

// ============================================================
// TABS
// ============================================================
function showTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  $('panel-' + name).classList.add('active');

  if (name === 'register') renderRegister();
  if (name === 'master') renderMaster();
}

// ============================================================
// REGISTER TAB
// ============================================================
async function renderRegister() {
  const wrap = $('reg-table-wrap');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div> Loading register…</div>';

  const coFilter = $('reg-co-filter').value;
  const search = $('reg-search').value.trim().toLowerCase();

  // Load challans + joined data
  let query = sb.from('challans').select(`
    id, dc_number, dc_date, total_bags, total_qty_qtl, total_value, bill_no, lorry_no, lr_no, transport, freight_status,
    company:companies(id, code, name),
    distributor:distributors(id, name, city),
    retailer:retailers(id, name, city)
  `).order('dc_date', { ascending: false }).order('dc_number', { ascending: false }).limit(500);

  if (coFilter) {
    const co = state.companies.find(c => c.code === coFilter);
    if (co) query = query.eq('company_id', co.id);
  }

  const { data: challans, error } = await query;
  if (error) {
    wrap.innerHTML = '<div class="empty"><div class="empty-title">Failed to load</div>' + error.message + '</div>';
    return;
  }

  // Apply search filter client-side (small data set)
  let filtered = challans || [];
  if (search) {
    filtered = filtered.filter(c => {
      const haystack = [
        c.dc_number, c.distributor?.name, c.retailer?.name,
        c.bill_no, c.lorry_no, c.transport,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }

  state.challans = filtered;

  if (filtered.length === 0) {
    wrap.innerHTML = '<div class="empty"><div class="empty-title">No challans yet</div>Create one in the New Batch tab.</div>';
    return;
  }

  wrap.innerHTML = `<table class="reg-table">
    <thead>
      <tr>
        <th>Co.</th>
        <th>DC No.</th>
        <th>Date</th>
        <th>Bill To</th>
        <th>Ship To</th>
        <th style="text-align:right">Bags</th>
        <th style="text-align:right">Qtl</th>
        <th style="text-align:right">Value (₹)</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${filtered.map(c => `<tr>
        <td><span class="reg-co ${c.company?.code === 'ASIAN' ? 'asian' : 'asn'}">${c.company?.code || '—'}</span></td>
        <td class="reg-dcno">${c.company?.code || ''}-${c.dc_number}</td>
        <td>${fmt(c.dc_date)}</td>
        <td>${c.distributor?.name || '—'}</td>
        <td>${c.retailer?.name || '—'}</td>
        <td style="text-align:right">${c.total_bags}</td>
        <td style="text-align:right">${Number(c.total_qty_qtl).toFixed(2)}</td>
        <td style="text-align:right">${fmtIN(c.total_value)}</td>
        <td><button class="btn btn-sm" onclick="reprintChallan('${c.id}')">View</button></td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

async function reprintChallan(challanId) {
  toast('Loading challan…');
  const { data: ch, error } = await sb.from('challans').select(`
    *,
    company:companies(*),
    distributor:distributors(*),
    retailer:retailers(*),
    items:challan_items(*)
  `).eq('id', challanId).single();

  if (error) { toast('Failed: ' + error.message, true); return; }

  // The DB has one row per lot allocation. Re-group consecutive rows with the same
  // product into product groups (preserving the original order via `position`).
  const flat = (ch.items || []).sort((a, b) => a.position - b.position);
  const groups = [];
  for (const row of flat) {
    const prev = groups[groups.length - 1];
    // Same group if same product appears in adjacent positions
    if (prev && prev.product_id === row.product_id) {
      prev.lots.push({
        lot_id: row.lot_id,
        lot_number: row.lot_number,
        bags: row.bags,
        qty_qtl: row.qty_qtl,
      });
    } else {
      groups.push({
        product_id: row.product_id,
        product_name: row.product_name,
        packing_size_kg: row.packing_size_kg,
        rate_per_bag: row.rate_per_bag,
        lots: [{
          lot_id: row.lot_id,
          lot_number: row.lot_number,
          bags: row.bags,
          qty_qtl: row.qty_qtl,
        }],
      });
    }
  }

  // A challan saved in handwrite mode has blank lot_number on every item.
  const isHandwrite = flat.length > 0 && flat.every(r => !r.lot_number);

  const d = {
    dc_number: ch.dc_number,
    company: ch.company,
    distributor: ch.distributor,
    retailer: ch.retailer,
    dc_date: ch.dc_date,
    lorry_no: ch.lorry_no,
    transport: ch.transport,
    freight_status: ch.freight_status,
    total_bags: ch.total_bags,
    total_qty_qtl: ch.total_qty_qtl,
    total_value: ch.total_value,
    handwrite: isHandwrite,
    items: groups,
  };

  showChallanPreview(d);
}

function exportRegisterExcel() {
  if (!state.challans || state.challans.length === 0) {
    toast('Nothing to export', true);
    return;
  }
  const rows = state.challans.map(c => ({
    Company: c.company?.code || '',
    'DC No.': `${c.company?.code}-${c.dc_number}`,
    Date: fmt(c.dc_date),
    'Bill To': c.distributor?.name || '',
    'Bill To City': c.distributor?.city || '',
    'Ship To': c.retailer?.name || '',
    'Ship To City': c.retailer?.city || '',
    'Total Bags': c.total_bags,
    'Total Qtl': c.total_qty_qtl,
    'Value (₹)': c.total_value,
    'Bill No.': c.bill_no || '',
    'Lorry No.': c.lorry_no || '',
    'LR No.': c.lr_no || '',
    Transport: c.transport || '',
    Freight: c.freight_status || '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Register');
  XLSX.writeFile(wb, `challan-register-${fmt(new Date())}.xlsx`);
}

// ============================================================
// MASTER DATA TAB
// ============================================================
function renderMaster() {
  renderDistList();
  renderRetList();
  renderProdList();
  renderLotList();
  renderCoList();
}

function renderDistList() {
  $('dist-list').innerHTML = `<table class="reg-table">
    <thead><tr><th>Name</th><th>City</th><th>Manager</th><th>Phone</th><th>GSTIN</th><th></th></tr></thead>
    <tbody>${state.distributors.map(d => `<tr>
      <td>${d.name}</td><td>${d.city || '—'}</td><td>${d.manager || '—'}</td><td>${d.phone || '—'}</td><td>${d.gstin || '—'}</td>
      <td><button class="btn btn-sm" onclick="editDistributor('${d.id}')">Edit</button></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">No distributors</td></tr>'}</tbody>
  </table>`;
}

function renderRetList() {
  $('ret-list').innerHTML = `<table class="reg-table">
    <thead><tr><th>Name</th><th>City</th><th>Phone</th><th>Distributor</th><th></th></tr></thead>
    <tbody>${state.retailers.map(r => {
      const dist = state.distributors.find(d => d.id === r.distributor_id);
      return `<tr>
        <td>${r.name}</td><td>${r.city || '—'}</td><td>${r.phone || '—'}</td><td>${dist?.name || '—'}</td>
        <td><button class="btn btn-sm" onclick="editRetailer('${r.id}')">Edit</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">No retailers</td></tr>'}</tbody>
  </table>`;
}

function renderProdList() {
  $('prod-list').innerHTML = `<table class="reg-table">
    <thead><tr><th>Company</th><th>Name</th><th>Pack (kg)</th><th>Rate (₹/bag)</th><th></th></tr></thead>
    <tbody>${state.products.map(p => {
      const co = state.companies.find(c => c.id === p.company_id);
      return `<tr>
        <td><span class="reg-co ${co?.code === 'ASIAN' ? 'asian' : 'asn'}">${co?.code || '—'}</span></td>
        <td>${p.name}</td><td>${p.packing_size_kg}</td><td>${fmtIN(p.rate_per_bag)}</td>
        <td><button class="btn btn-sm" onclick="editProduct('${p.id}')">Edit</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">No products</td></tr>'}</tbody>
  </table>`;
}

function renderLotList() {
  $('lot-list').innerHTML = `<table class="reg-table">
    <thead><tr><th>Co.</th><th>Product</th><th>Lot No.</th><th style="text-align:right">Available</th><th style="text-align:right">Initial</th><th></th></tr></thead>
    <tbody>${state.lots.map(l => {
      const prod = state.products.find(p => p.id === l.product_id);
      const co = prod ? state.companies.find(c => c.id === prod.company_id) : null;
      const low = l.bags_available < 50;
      return `<tr>
        <td><span class="reg-co ${co?.code === 'ASIAN' ? 'asian' : 'asn'}">${co?.code || '—'}</span></td>
        <td>${prod?.name || '—'}</td>
        <td style="font-family:'JetBrains Mono',monospace">${l.lot_number}</td>
        <td style="text-align:right${low ? ';color:var(--red);font-weight:600' : ''}">${l.bags_available}</td>
        <td style="text-align:right;color:var(--muted)">${l.initial_bags}</td>
        <td><button class="btn btn-sm" onclick="editLot('${l.id}')">Edit</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">No lots yet \u2014 click "+ Add Lot" or import via Excel</td></tr>'}</tbody>
  </table>`;
}

function renderCoList() {
  $('co-list').innerHTML = `<table class="reg-table">
    <thead><tr><th>Code</th><th>Name</th><th>Next DC #</th><th>GSTIN</th><th></th></tr></thead>
    <tbody>${state.companies.map(c => `<tr>
      <td><span class="reg-co ${c.code === 'ASIAN' ? 'asian' : 'asn'}">${c.code}</span></td>
      <td>${c.name}</td><td class="reg-dcno">${c.next_dc_number}</td><td>${c.gstin || '—'}</td>
      <td><button class="btn btn-sm" onclick="editCompany('${c.id}')">Edit</button></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

// ── Master data: add/edit dialogs (prompt-based for v1; simple but functional) ──
async function addDistributor() {
  const name = prompt('Distributor name:');
  if (!name) return;
  const city = prompt('City:') || '';
  const manager = prompt('Manager (person responsible for this distributor, optional):') || null;
  const phone = prompt('Phone (optional):') || null;
  const gstin = prompt('GSTIN (optional):') || null;
  const { error } = await sb.from('distributors').insert({ name, city, manager, gstin, phone });
  if (error) { toast(error.message, true); return; }
  await loadAllData(); renderMaster(); toast('Added.');
}

async function editDistributor(id) {
  const d = state.distributors.find(x => x.id === id);
  if (!d) return;
  const action = prompt(`Edit distributor: ${d.name}\n\nType:\n1 — rename\n2 — change city\n3 — set manager\n4 — set phone\n5 — set GSTIN\n6 — set address\n7 — DELETE`);
  if (!action) return;
  const upd = {};
  if (action === '1') upd.name = prompt('New name:', d.name);
  else if (action === '2') upd.city = prompt('New city:', d.city || '');
  else if (action === '3') upd.manager = prompt('Manager:', d.manager || '');
  else if (action === '4') upd.phone = prompt('New phone:', d.phone || '');
  else if (action === '5') upd.gstin = prompt('New GSTIN:', d.gstin || '');
  else if (action === '6') upd.address = prompt('New address:', d.address || '');
  else if (action === '7') {
    if (!confirm(`Really DELETE ${d.name}? (will fail if retailers/challans reference it)`)) return;
    const { error } = await sb.from('distributors').delete().eq('id', id);
    if (error) { toast(error.message, true); return; }
    await loadAllData(); renderMaster(); toast('Deleted.'); return;
  }
  else return;
  const { error } = await sb.from('distributors').update(upd).eq('id', id);
  if (error) { toast(error.message, true); return; }
  await loadAllData(); renderMaster(); toast('Updated.');
}

async function addRetailer() {
  const name = prompt('Retailer name:');
  if (!name) return;
  const city = prompt('City:') || '';
  const phone = prompt('Phone (optional, will appear on DC):') || null;
  // Pick distributor
  const distList = state.distributors.map((d, i) => `${i+1}. ${d.name}`).join('\n');
  const idx = parseInt(prompt(`Distributor:\n${distList}\n\nEnter number:`), 10);
  if (isNaN(idx) || idx < 1 || idx > state.distributors.length) { toast('Invalid distributor', true); return; }
  const dist = state.distributors[idx - 1];
  const { error } = await sb.from('retailers').insert({ name, city, phone, distributor_id: dist.id });
  if (error) { toast(error.message, true); return; }
  await loadAllData(); renderMaster(); toast('Added.');
}

async function editRetailer(id) {
  const r = state.retailers.find(x => x.id === id);
  if (!r) return;
  const action = prompt(`Edit retailer: ${r.name}\n\nType:\n1 — rename\n2 — change city\n3 — change distributor\n4 — set phone\n5 — set address\n6 — DELETE`);
  if (!action) return;
  const upd = {};
  if (action === '1') upd.name = prompt('New name:', r.name);
  else if (action === '2') upd.city = prompt('New city:', r.city || '');
  else if (action === '3') {
    const distList = state.distributors.map((d, i) => `${i+1}. ${d.name}`).join('\n');
    const idx = parseInt(prompt(`Distributor:\n${distList}\n\nNumber:`), 10);
    if (isNaN(idx)) return;
    upd.distributor_id = state.distributors[idx - 1].id;
  }
  else if (action === '4') upd.phone = prompt('Phone:', r.phone || '');
  else if (action === '5') upd.address = prompt('Address:', r.address || '');
  else if (action === '6') {
    if (!confirm(`DELETE ${r.name}?`)) return;
    const { error } = await sb.from('retailers').delete().eq('id', id);
    if (error) { toast(error.message, true); return; }
    await loadAllData(); renderMaster(); toast('Deleted.'); return;
  }
  else return;
  const { error } = await sb.from('retailers').update(upd).eq('id', id);
  if (error) { toast(error.message, true); return; }
  await loadAllData(); renderMaster(); toast('Updated.');
}

async function addProduct() {
  const name = prompt('Product name (e.g. "SOYBEAN SEEDS ASIAN-777 Certified Seeds"):');
  if (!name) return;
  const coList = state.companies.map((c, i) => `${i+1}. ${c.name}`).join('\n');
  const idx = parseInt(prompt(`Company:\n${coList}\n\nNumber:`), 10);
  if (isNaN(idx)) return;
  const co = state.companies[idx - 1];
  const pack = parseFloat(prompt('Packing size (kg, e.g. 25 or 27):'));
  const rate = parseFloat(prompt('Rate per bag (₹, e.g. 4077):')) || 0;
  if (isNaN(pack)) { toast('Invalid pack size', true); return; }
  const { error } = await sb.from('products').insert({
    company_id: co.id, name, packing_size_kg: pack, rate_per_bag: rate
  });
  if (error) { toast(error.message, true); return; }
  await loadAllData(); renderMaster(); toast('Added.');
}

async function editProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  const action = prompt(`Edit product: ${p.name}\n\nType:\n1 — rename\n2 — change pack size\n3 — change rate\n4 — DELETE`);
  if (!action) return;
  const upd = {};
  if (action === '1') upd.name = prompt('New name:', p.name);
  else if (action === '2') upd.packing_size_kg = parseFloat(prompt('Pack (kg):', p.packing_size_kg));
  else if (action === '3') upd.rate_per_bag = parseFloat(prompt('Rate per bag:', p.rate_per_bag));
  else if (action === '4') {
    if (!confirm(`DELETE ${p.name}?`)) return;
    const { error } = await sb.from('products').delete().eq('id', id);
    if (error) { toast(error.message, true); return; }
    await loadAllData(); renderMaster(); toast('Deleted.'); return;
  }
  else return;
  const { error } = await sb.from('products').update(upd).eq('id', id);
  if (error) { toast(error.message, true); return; }
  await loadAllData(); renderMaster(); toast('Updated.');
}

async function addLot() {
  if (state.products.length === 0) {
    toast('Add a product first', true);
    return;
  }
  const prodList = state.products.map((p, i) => {
    const co = state.companies.find(c => c.id === p.company_id);
    return `${i+1}. [${co?.code || '?'}] ${p.name}`;
  }).join('\n');
  const idx = parseInt(prompt(`Which product is this lot for?\n\n${prodList}\n\nEnter number:`), 10);
  if (isNaN(idx) || idx < 1 || idx > state.products.length) { toast('Invalid product', true); return; }
  const prod = state.products[idx - 1];
  const lotNo = prompt('Lot number (e.g. OCT25-12-IND-123):');
  if (!lotNo) return;
  const bags = parseInt(prompt(`Bags in lot "${lotNo}":`), 10);
  if (isNaN(bags) || bags < 0) { toast('Invalid bags', true); return; }
  const { error } = await sb.from('product_lots').insert({
    product_id: prod.id, lot_number: lotNo.trim(), bags_available: bags, initial_bags: bags
  });
  if (error) { toast(error.message, true); return; }
  await loadAllData(); renderMaster(); toast(`Lot ${lotNo} added (${bags} bags).`);
}

async function editLot(id) {
  const l = state.lots.find(x => x.id === id);
  if (!l) return;
  const action = prompt(`Edit lot: ${l.lot_number}\n(Available: ${l.bags_available}, Initial: ${l.initial_bags})\n\nType:\n1 — adjust available bags (manual correction)\n2 — change lot number\n3 — disable (won't show in dropdowns)\n4 — enable\n5 — DELETE`);
  if (!action) return;
  const upd = {};
  if (action === '1') {
    const newAvail = parseInt(prompt('New available bags:', l.bags_available), 10);
    if (isNaN(newAvail)) return;
    upd.bags_available = newAvail;
  }
  else if (action === '2') upd.lot_number = prompt('New lot number:', l.lot_number);
  else if (action === '3') upd.active = false;
  else if (action === '4') upd.active = true;
  else if (action === '5') {
    if (!confirm(`DELETE lot ${l.lot_number}?`)) return;
    const { error } = await sb.from('product_lots').delete().eq('id', id);
    if (error) { toast(error.message, true); return; }
    await loadAllData(); renderMaster(); toast('Deleted.'); return;
  }
  else return;
  const { error } = await sb.from('product_lots').update(upd).eq('id', id);
  if (error) { toast(error.message, true); return; }
  await loadAllData(); renderMaster(); toast('Updated.');
}

async function editCompany(id) {
  const c = state.companies.find(x => x.id === id);
  if (!c) return;
  const action = prompt(`Edit ${c.name}\n\nType:\n1 — change name\n2 — change GSTIN\n3 — change CIN\n4 — change phone\n5 — change email\n6 — change next DC number\n7 — change office address\n8 — change plant address\n9 — set logo (paste image data URL)`);
  if (!action) return;
  const upd = {};
  if (action === '1') upd.name = prompt('Name:', c.name);
  else if (action === '2') upd.gstin = prompt('GSTIN:', c.gstin || '');
  else if (action === '3') upd.cin = prompt('CIN:', c.cin || '');
  else if (action === '4') upd.phone = prompt('Phone:', c.phone || '');
  else if (action === '5') upd.email = prompt('Email:', c.email || '');
  else if (action === '6') {
    const n = parseInt(prompt('Next DC #:', c.next_dc_number), 10);
    if (!isNaN(n)) upd.next_dc_number = n;
  }
  else if (action === '7') upd.office_addr = prompt('Office address:', c.office_addr || '');
  else if (action === '8') upd.plant_addr = prompt('Plant address:', c.plant_addr);
  else if (action === '9') upd.logo_url = prompt('Logo data URL (base64):', c.logo_url || '');
  else return;
  const { error } = await sb.from('companies').update(upd).eq('id', id);
  if (error) { toast(error.message, true); return; }
  await loadAllData(); renderMaster(); toast('Updated.');
}

// ============================================================
// EXCEL TEMPLATES + BULK IMPORT
// ============================================================
// Schemas: what columns each import expects, what's required, and how to
// transform each row into a DB insert object.
const IMPORT_SCHEMAS = {
  distributors: {
    label: 'distributors',
    required: ['name'],
    columns: ['name', 'city', 'manager', 'gstin', 'license_no', 'phone', 'address'],
    table: 'distributors',
    mapRow: (r) => ({
      name:       (r.name || '').trim(),
      city:       (r.city || '').trim() || null,
      manager:    (r.manager || '').trim() || null,
      gstin:      (r.gstin || '').trim() || null,
      license_no: (r.license_no || '').trim() || null,
      phone:      (r.phone != null ? String(r.phone) : '').trim() || null,
      address:    (r.address || '').trim() || null,
    }),
  },
  retailers: {
    label: 'retailers',
    required: ['name', 'distributor_name'],
    columns: ['name', 'city', 'phone', 'distributor_name', 'gstin', 'license_no', 'address'],
    table: 'retailers',
    mapRow: (r) => {
      const distName = (r.distributor_name || '').trim();
      const dist = state.distributors.find(d => d.name.toLowerCase() === distName.toLowerCase());
      if (!dist) throw new Error(`Distributor not found: "${distName}"`);
      return {
        name:           (r.name || '').trim(),
        city:           (r.city || '').trim() || null,
        phone:          (r.phone != null ? String(r.phone) : '').trim() || null,
        distributor_id: dist.id,
        gstin:          (r.gstin || '').trim() || null,
        license_no:     (r.license_no || '').trim() || null,
        address:        (r.address || '').trim() || null,
      };
    },
  },
  lots: {
    label: 'lots',
    required: ['product_name', 'lot_number', 'bags'],
    columns: ['product_name', 'lot_number', 'bags', 'manufacture_date', 'expiry_date', 'notes'],
    table: 'product_lots',
    mapRow: (r) => {
      const prodName = (r.product_name || '').trim();
      const product = state.products.find(p => p.name.toLowerCase() === prodName.toLowerCase());
      if (!product) throw new Error(`Product not found: "${prodName}"`);
      const bags = parseInt(r.bags, 10);
      if (isNaN(bags) || bags < 0) throw new Error(`Invalid bag count for lot ${r.lot_number}`);
      return {
        product_id:     product.id,
        lot_number:     String(r.lot_number).trim(),
        bags_available: bags,
        initial_bags:   bags,
        manufacture_date: parseDateCell(r.manufacture_date),
        expiry_date:    parseDateCell(r.expiry_date),
        notes:          (r.notes || '').trim() || null,
      };
    },
  },
};

function parseDateCell(v) {
  if (!v) return null;
  // SheetJS sometimes returns Excel dates as JS Date objects; sometimes strings
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  // Accept YYYY-MM-DD or DD/MM/YYYY or DD-MM-YYYY
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

// Generate and download a starter Excel for the given table
function downloadTemplate(kind) {
  const schema = IMPORT_SCHEMAS[kind];
  if (!schema) return;

  // SheetJS aoa_to_sheet builds from an array of arrays
  const aoa = [schema.columns];

  // Add a sample row to make the format obvious
  const samples = {
    distributors: ['(sample) Santosh Beej Bhandar', 'Nanded', 'Rakesh Kumar', '27ABCDE1234F1Z5', 'MH/2024/1234', '9876543210', 'Main Road, Nanded'],
    retailers:    ['(sample) Pandurang KSK', 'Himayatnagar', '9876543210', 'Santosh Beej Bhandar', '', '', ''],
    lots:         ['(sample) SOYBEAN SEEDS ASIAN-777 Certified Seeds', 'OCT25-12-IND-123', 500, '2025-10-15', '2026-10-15', 'first batch'],
  };
  aoa.push(samples[kind]);
  aoa.push(['(delete this and the sample row before importing)']);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Make the header row bold-ish by setting column widths
  ws['!cols'] = schema.columns.map(c => ({ wch: Math.max(14, c.length + 4) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, kind);
  XLSX.writeFile(wb, `${kind}_template.xlsx`);
  toast(`Template downloaded: ${kind}_template.xlsx`);
}

// Read an uploaded Excel file and bulk-insert into the relevant table
async function importExcel(kind, inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  inputEl.value = ''; // allow re-uploading the same filename later

  const schema = IMPORT_SCHEMAS[kind];

  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });

    if (rows.length === 0) {
      toast('Sheet is empty', true);
      return;
    }

    // Filter out blank rows and rows that look like sample/instruction lines
    const cleanRows = rows.filter(r => {
      const firstVal = r[schema.columns[0]];
      if (!firstVal) return false;
      const s = String(firstVal).toLowerCase();
      if (s.includes('(sample)') || s.includes('(example)') || s.includes('delete this')) return false;
      return true;
    });

    if (cleanRows.length === 0) {
      toast('No valid rows found (did you delete the sample rows?)', true);
      return;
    }

    if (!confirm(`Import ${cleanRows.length} ${schema.label} from "${file.name}"?\n\nThis will ADD them — existing entries are kept.`)) {
      return;
    }

    // Transform + validate each row
    const inserts = [];
    const errors = [];
    for (let i = 0; i < cleanRows.length; i++) {
      const r = cleanRows[i];
      const rowNum = i + 2; // +2 for header row + 1-indexed

      // Check required fields
      const missing = schema.required.filter(f => !r[f] && r[f] !== 0);
      if (missing.length) {
        errors.push(`Row ${rowNum}: missing ${missing.join(', ')}`);
        continue;
      }

      try {
        inserts.push(schema.mapRow(r));
      } catch (e) {
        errors.push(`Row ${rowNum}: ${e.message}`);
      }
    }

    if (errors.length && inserts.length === 0) {
      alert('Import failed:\n\n' + errors.slice(0, 10).join('\n') + (errors.length > 10 ? `\n…and ${errors.length - 10} more` : ''));
      return;
    }
    if (errors.length) {
      const ok = confirm(`${errors.length} row(s) had problems and will be SKIPPED:\n\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? '\n…\n' : ''}\n\nContinue with ${inserts.length} good row(s)?`);
      if (!ok) return;
    }

    // Insert in chunks of 100 to keep requests fast
    const CHUNK = 100;
    let inserted = 0;
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const chunk = inserts.slice(i, i + CHUNK);
      const { error } = await sb.from(schema.table).insert(chunk);
      if (error) {
        toast(`Import stopped after ${inserted}: ${error.message}`, true);
        break;
      }
      inserted += chunk.length;
    }

    await loadAllData();
    renderMaster();
    toast(`Imported ${inserted} ${schema.label}${errors.length ? ` (${errors.length} skipped)` : ''}.`);
  } catch (e) {
    console.error(e);
    toast('Import error: ' + (e.message || e), true);
  }
}

// ============================================================
// BOOT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  // Sanity check config
  if (!window.SUPABASE_URL || window.SUPABASE_URL.includes('YOUR_SUPABASE_URL')) {
    document.body.innerHTML = `<div style="padding:40px;max-width:600px;margin:60px auto;font-family:system-ui;background:#fff;border:1px solid #ddd;border-radius:8px">
      <h2 style="font-family:Fraunces,serif;color:#b73e3e">⚠ Config missing</h2>
      <p>Edit <code>config.js</code> and set your Supabase URL and anon key before opening this app.</p>
      <p>Find these values in your Supabase dashboard under <strong>Project Settings → API</strong>.</p>
    </div>`;
    return;
  }
  init();
});
