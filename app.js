// ============================================================
// ASN Agri / Asian Seeds — Challan System (frontend logic)
// ============================================================

// ── Supabase client ───────────────────────────────────────────
const sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// ── In-memory cache ───────────────────────────────────────────
const state = {
  user: null,
  companies: [],       // [{id, code, name, ...}]
  distributors: [],    // [{id, name, city, manager, ...}]
  retailers: [],       // [{id, name, city, distributor_id}]
  products: [],        // [{id, company_id, name, packing_size_kg, rate_per_bag}]
  lots: [],            // [{id, product_id, lot_number, bags_available}]
  challans: [],        // recent challans for register
  parties: [],         // [{id, dist_id, dist_name, ret_id, ret_name, items:[]}]
  handwrite: false,    // when true: skip lot picking + stock checks, print blank lot lines
  challanType: 'regular', // 'regular' (distributor/retailer) or 'local' (direct farmer)
  demoMode: false,     // when true: all reads/writes use in-memory fixtures
  demoChallans: [],    // challans created during demo session
  editingChallanId: null,
  editingDcNumber: null,
  editingCompanyId: null,
  editingOriginalItems: [],
  demoDcCounters: {},  // {company_id: next_dc_number}
  demoLocalDcCounters: {}, // {company_id: next_local_dc_number}
};

// ── DC number helpers ──────────────────────────────────────────
// formatDcNumber: returns "L-01" for local, plain number for regular
function formatDcNumber(num, type) {
  if (type === 'local') return 'L-' + String(num).padStart(2, '0');
  return String(num);
}

// ── Demo fixture data ─────────────────────────────────────────
const DEMO_DATA = {
  companies: [
    { id: 'demo-co-asn', code: 'ASN', name: 'ASN Agri Private Limited',
      tagline: 'Quality Seeds for Better Yields',
      plant_addr: 'Survey No. 123, Industrial Area, Indore, MP 452001',
      office_addr: '456 Agri House, Palasia Square, Indore, MP',
      gstin: '23AABCA1234B1Z5', cin: 'U01110MP2010PTC000001',
      lic1: 'MP/SEED/2023/001', lic2: 'MP/SEED/2023/002',
      email: 'info@asnagri.com', phone: '+91 73199 20000',
      next_dc_number: 1, next_local_dc_number: 1, logo_url: null },
    { id: 'demo-co-asian', code: 'ASIAN', name: 'Asian Seeds Private Limited',
      tagline: "Harvesting Tomorrow's Potential",
      plant_addr: 'Plot 78, MIDC Phase II, Aurangabad, MH 431001',
      office_addr: null,
      gstin: '27AABCA5678C1Z2', cin: null,
      lic1: 'MH/SEED/2023/100', lic2: null,
      email: 'contact@asianseeds.in', phone: '+91 90490 15000',
      next_dc_number: 1, next_local_dc_number: 1, logo_url: null },
  ],
  distributors: [
    { id: 'demo-d1', name: 'Santosh Beej Bhandar', city: 'Nanded',  manager: 'Rakesh Kumar',    phone: '9876543210', gstin: '27ABCDE1234F1Z5', address: 'Main Road, Nanded' },
    { id: 'demo-d2', name: 'Krishi Seva Kendra',   city: 'Latur',   manager: 'Suresh Patil',    phone: '9876500001', gstin: '27FGHIJ5678K1Z3', address: 'Near Bus Stand, Latur' },
    { id: 'demo-d3', name: 'Agro Input Centre',    city: 'Akola',   manager: 'Vijay Deshmukh',  phone: '9876500002', gstin: null,               address: 'Shivaji Nagar, Akola' },
  ],
  retailers: [
    { id: 'demo-r1', name: 'Pandurang KSK',        city: 'Himayatnagar', phone: '9000000001', distributor_id: 'demo-d1', address: null, gstin: null },
    { id: 'demo-r2', name: 'Shri Sai Beej Bhandar',city: 'Nanded',       phone: '9000000002', distributor_id: 'demo-d1', address: null, gstin: null },
    { id: 'demo-r3', name: 'Vasant Krishi Centre', city: 'Udgir',        phone: '9000000003', distributor_id: 'demo-d2', address: null, gstin: null },
    { id: 'demo-r4', name: 'Vitthal Seeds',         city: 'Latur',        phone: '9000000004', distributor_id: 'demo-d2', address: null, gstin: null },
    { id: 'demo-r5', name: 'Gurukripa Agro',        city: 'Murtizapur',   phone: '9000000005', distributor_id: 'demo-d3', address: null, gstin: null },
    { id: 'demo-r6', name: 'New Kisan Centre',      city: 'Akola',        phone: '9000000006', distributor_id: 'demo-d3', address: null, gstin: null },
  ],
  products: [
    { id: 'demo-p1', company_id: 'demo-co-asn',   name: 'SOYBEAN SEEDS ASN-101 Certified Seeds',    packing_size_kg: 30,   rate_per_bag: 1800 },
    { id: 'demo-p2', company_id: 'demo-co-asn',   name: 'WHEAT SEEDS ASN-777 Certified Seeds',      packing_size_kg: 40,   rate_per_bag: 1200 },
    { id: 'demo-p3', company_id: 'demo-co-asn',   name: 'CHICKPEA SEEDS ASN-Gold Certified Seeds',  packing_size_kg: 25,   rate_per_bag: 2200 },
    { id: 'demo-p4', company_id: 'demo-co-asian', name: 'SOYBEAN SEEDS ASIAN-777 Certified Seeds',  packing_size_kg: 30,   rate_per_bag: 2100 },
    { id: 'demo-p5', company_id: 'demo-co-asian', name: 'COTTON SEEDS ASIAN-BT Certified Seeds',    packing_size_kg: 0.45, rate_per_bag: 900  },
  ],
  lots: [
    { id: 'demo-l1', product_id: 'demo-p1', lot_number: 'OCT25-01-IND-001', bags_available: 500,  initial_bags: 500,  active: true },
    { id: 'demo-l2', product_id: 'demo-p1', lot_number: 'OCT25-01-IND-002', bags_available: 320,  initial_bags: 400,  active: true },
    { id: 'demo-l3', product_id: 'demo-p2', lot_number: 'NOV25-02-IND-001', bags_available: 800,  initial_bags: 800,  active: true },
    { id: 'demo-l4', product_id: 'demo-p3', lot_number: 'OCT25-03-IND-001', bags_available: 45,   initial_bags: 200,  active: true },
    { id: 'demo-l5', product_id: 'demo-p4', lot_number: 'SEP25-04-AUR-001', bags_available: 600,  initial_bags: 600,  active: true },
    { id: 'demo-l6', product_id: 'demo-p4', lot_number: 'SEP25-04-AUR-002', bags_available: 150,  initial_bags: 300,  active: true },
    { id: 'demo-l7', product_id: 'demo-p5', lot_number: 'AUG25-05-AUR-001', bags_available: 1200, initial_bags: 1200, active: true },
  ],
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
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    state.user = session.user;
    await enterApp();
  } else {
    $('login-screen').style.display = 'flex';
    $('app').style.display = 'none';
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'TOKEN_REFRESHED') {
      state.user = session.user;
    } else if (session) {
      state.user = session.user;
      await enterApp();
    } else {
      state.user = null;
      $('login-screen').style.display = 'flex';
      $('app').style.display = 'none';
      if (event === 'SIGNED_OUT') return;
      const msg = $('login-msg');
      if (msg) { msg.style.color = '#e67e22'; msg.textContent = 'Session expired — please sign in again.'; }
    }
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    await loadAllData();
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
}

async function handleLogout() {
  await sb.auth.signOut();
}

async function enterApp() {
  $('login-screen').style.display = 'none';
  $('app').style.display = 'block';
  $('user-chip').textContent = state.user.email;
  if (state.demoMode) $('demo-banner').style.display = 'block';

  $('f-date').value = fmt(new Date());

  await loadAllData();

  state.parties = [makeParty()];
  renderParties();
  updateTotals();
  updateCompanyMeta();
  renderChallanTypeToggle();

  restoreTab();
}

// ============================================================
// DATA LOADING
// ============================================================
async function loadAllData() {
  if (state.demoMode) {
    if (state.lots.length === 0) {
      state.companies    = DEMO_DATA.companies;
      state.distributors = DEMO_DATA.distributors;
      state.retailers    = DEMO_DATA.retailers;
      state.products     = DEMO_DATA.products;
      state.lots         = JSON.parse(JSON.stringify(DEMO_DATA.lots));
    }
    updateCompanyMeta();
    return;
  }
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
// CHALLAN TYPE TOGGLE (Regular vs Local/Farmer)
// ============================================================
function renderChallanTypeToggle() {
  const wrap = $('challan-type-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center">
      <button id="type-btn-regular" onclick="setChallanType('regular')"
        class="btn${state.challanType === 'regular' ? ' btn-primary' : ''}"
        style="min-width:180px">
        🏪 Regular (Distributor / Retailer)
      </button>
      <button id="type-btn-local" onclick="setChallanType('local')"
        class="btn${state.challanType === 'local' ? ' btn-primary' : ''}"
        style="min-width:180px">
        🌾 Local Farmer (L-series)
      </button>
    </div>
    ${state.challanType === 'local' ? '<div class="hint" style="font-size:11px;color:var(--muted);margin-top:6px">DC numbers will be L-01, L-02… — separate from the regular series. Distributor/retailer not required.</div>' : ''}
  `;
}

function setChallanType(type) {
  if (state.editingChallanId) {
    toast('Cannot change challan type while editing an existing DC', true);
    return;
  }
  state.challanType = type;
  renderChallanTypeToggle();
  // Re-render parties so the Bill To / Ship To fields toggle appropriately
  renderParties();
}

// ============================================================
// SEARCHABLE COMBOBOXES
// ============================================================
function setupPartyCombo(partyId) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  // In local/farmer mode there are no combos to set up
  if (state.challanType === 'local') return;

  setupCombo({
    inputId:  `dist-input-${partyId}`,
    hiddenId: `dist-hidden-${partyId}`,
    listId:   `dist-list-${partyId}`,
    source:   () => state.distributors,
    onPick:   (id, name) => {
      p.dist_id = id; p.dist_name = name;
      p.ret_id = ''; p.ret_name = '';
      const ri = $(`ret-input-${partyId}`);
      if (ri) { ri.value = ''; ri.classList.remove('has-selection'); ri.disabled = false; ri.placeholder = 'Type to search…'; }
      const rh = $(`ret-hidden-${partyId}`);
      if (rh) rh.value = '';
      const cb = $(`ship-dist-${partyId}`);
      if (cb) cb.disabled = false;
    },
  });
  setupCombo({
    inputId:  `ret-input-${partyId}`,
    hiddenId: `ret-hidden-${partyId}`,
    listId:   `ret-list-${partyId}`,
    source:   () => {
      const distId = $(`dist-hidden-${partyId}`)?.value || p.dist_id;
      if (!distId) return [];
      return state.retailers.filter(r => r.distributor_id === distId);
    },
    onPick: (id, name) => { p.ret_id = id; p.ret_name = name; },
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
    if (onPick) onPick(id, name);
  }

  input.addEventListener('focus', () => { render(input.value); });
  input.addEventListener('input', () => {
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
// PARTY MANAGEMENT
// ============================================================
function makeParty() {
  return { id: Math.random().toString(36).slice(2), dist_id: '', dist_name: '', ret_id: '', ret_name: '', ship_to_dist: false, farmer_name: '', farmer_village: '', farmer_phone: '', items: [] };
}

function addParty() {
  state.parties.push(makeParty());
  renderParties();
  updateTotals();
}

function removeParty(partyId) {
  if (state.parties.length <= 1) { toast('At least one party required', true); return; }
  state.parties = state.parties.filter(p => p.id !== partyId);
  renderParties();
  updateTotals();
}

function toggleShipToDist(partyId) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  p.ship_to_dist = !p.ship_to_dist;
  if (p.ship_to_dist) { p.ret_id = ''; p.ret_name = ''; }
  renderParties();
}

function updateFarmerField(partyId, field, value) {
  const p = state.parties.find(x => x.id === partyId);
  if (p) p[field] = value;
}

function renderParties() {
  const container = $('parties-container');
  if (!container) return;

  const isLocal = state.challanType === 'local';

  container.innerHTML = state.parties.map((p, idx) => {
    // ── LOCAL / FARMER MODE: simple name+village+phone instead of dist/retailer combos ──
    const partyHeader = isLocal ? `
      <div class="grid grid-3" style="margin-bottom:14px">
        <div class="field">
          <label>Farmer Name *</label>
          <input type="text" id="farmer-name-${p.id}" value="${escapeAttr(p.farmer_name || '')}"
            placeholder="e.g. Ramesh Patel"
            oninput="updateFarmerField('${p.id}','farmer_name',this.value)">
        </div>
        <div class="field">
          <label>Village / Address</label>
          <input type="text" id="farmer-village-${p.id}" value="${escapeAttr(p.farmer_village || '')}"
            placeholder="e.g. Sanawad, Khargone"
            oninput="updateFarmerField('${p.id}','farmer_village',this.value)">
        </div>
        <div class="field">
          <label>Phone</label>
          <input type="text" id="farmer-phone-${p.id}" value="${escapeAttr(p.farmer_phone || '')}"
            placeholder="10-digit number"
            oninput="updateFarmerField('${p.id}','farmer_phone',this.value)">
        </div>
      </div>
    ` : `
      <div class="grid grid-2" style="margin-bottom:14px">
        <div class="field">
          <label>Bill To (Distributor)</label>
          <div class="combo">
            <input type="text" class="combo-input${p.dist_name ? ' has-selection' : ''}" id="dist-input-${p.id}"
              placeholder="Type to search…" autocomplete="off" value="${escapeAttr(p.dist_name)}">
            <input type="hidden" id="dist-hidden-${p.id}" value="${escapeAttr(p.dist_id)}">
            <div class="combo-list" id="dist-list-${p.id}"></div>
          </div>
        </div>
        <div class="field">
          <label style="display:flex;align-items:center;gap:10px">
            Ship To (Retailer)
            <label style="font-weight:400;font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--muted)">
              <input type="checkbox" id="ship-dist-${p.id}" ${p.ship_to_dist ? 'checked' : ''} ${p.dist_id ? '' : 'disabled'}
                onchange="toggleShipToDist('${p.id}')"> Same as distributor
            </label>
          </label>
          <div class="combo">
            <input type="text" class="combo-input${p.ret_name ? ' has-selection' : ''}" id="ret-input-${p.id}"
              placeholder="${p.ship_to_dist ? 'Using distributor address' : (p.dist_id ? 'Type to search…' : 'Select distributor first…')}"
              autocomplete="off" value="${p.ship_to_dist ? '' : escapeAttr(p.ret_name)}" ${(p.dist_id && !p.ship_to_dist) ? '' : 'disabled'}>
            <input type="hidden" id="ret-hidden-${p.id}" value="${p.ship_to_dist ? '' : escapeAttr(p.ret_id)}">
            <div class="combo-list" id="ret-list-${p.id}"></div>
          </div>
        </div>
      </div>
    `;

    return `
    <div class="card party-card" id="party-card-${p.id}" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div class="section-label" style="margin:0">${isLocal ? '🌾 Farmer Stop' : 'Party'} ${idx + 1}</div>
        ${state.parties.length > 1 ? `<button class="btn btn-sm btn-icon" onclick="removeParty('${p.id}')" title="Remove party">&times;</button>` : ''}
      </div>
      ${partyHeader}
      <table class="items-table">
        <thead><tr>
          <th style="width:35px">#</th>
          <th>Product (Variety)</th>
          <th style="width:180px">Lot No. &amp; Stock</th>
          <th style="width:80px">Pack (kg)</th>
          <th style="width:80px">Bags</th>
          <th style="width:90px">Qty (Qtl)</th>
          ${isLocal ? '<th style="width:100px">Rate (₹/qtl)</th>' : ''}
          <th style="width:50px"></th>
        </tr></thead>
        <tbody id="items-tbody-${p.id}"></tbody>
      </table>
      <div style="margin-top:12px">
        <button class="btn btn-sm" onclick="addItem('${p.id}')">+ Add Item</button>
      </div>
    </div>
  `}).join('');

  state.parties.forEach(p => {
    setupPartyCombo(p.id);
    renderPartyItems(p.id);
  });
}

// ============================================================
// LINE ITEMS (per party)
// ============================================================
function onHandwriteToggle(checked) {
  state.handwrite = !!checked;
  state.parties.forEach(p => renderPartyItems(p.id));
  updateTotals();
}

function updateLotPrefix(partyId, itemId, value) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  const it = p.items.find(i => i.id === itemId);
  if (it) it.lot_prefix = value;
}

function updateItemRate(partyId, itemId, value) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  const it = p.items.find(i => i.id === itemId);
  if (!it) return;
  // User enters rate per quintal; internally we store rate per bag
  // rate_per_bag = rate_per_qtl × packing_size_kg / 100
  const ratePerQtl = parseFloat(value) || 0;
  const pack = Number(it.packing_size_kg) || 0;
  it.rate_per_bag = pack > 0 ? (ratePerQtl * pack) / 100 : 0;
  updateTotals();
}

function addItem(partyId) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  p.items.push({
    id: Math.random().toString(36).slice(2),
    product_id: '',
    company_id: '',
    packing_size_kg: '',
    rate_per_bag: 0,
    lot_prefix: '',
    lots: [makeLot()],
  });
  renderPartyItems(partyId);
}

function makeLot() {
  return {
    id: Math.random().toString(36).slice(2),
    lot_id: '',
    bags: '',
    qty_qtl: '',
  };
}

function addLotToItem(partyId, itemId) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  const it = p.items.find(i => i.id === itemId);
  if (!it) return;
  if (!it.product_id) { toast('Pick a product first', true); return; }
  it.lots.push(makeLot());
  renderPartyItems(partyId);
}

function delLot(partyId, itemId, lotRowId) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  const it = p.items.find(i => i.id === itemId);
  if (!it) return;
  if (it.lots.length <= 1) { toast('At least one lot required — remove the product instead', true); return; }
  it.lots = it.lots.filter(l => l.id !== lotRowId);
  renderPartyItems(partyId);
  updateTotals();
}

function delItem(partyId, itemId) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  p.items = p.items.filter(i => i.id !== itemId);
  renderPartyItems(partyId);
  updateTotals();
}

function renderItems() { state.parties.forEach(p => renderPartyItems(p.id)); }

function renderPartyItems(partyId) {
  const p = state.parties.find(x => x.id === partyId);
  const tbody = $(`items-tbody-${partyId}`);
  if (!p || !tbody) return;
  const isLocal = state.challanType === 'local';

  if (p.items.length === 0) {
    const cols = isLocal ? 8 : 7;
    tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;padding:16px;color:var(--muted);font-size:12px">
      No items yet. Click &ldquo;+ Add Item&rdquo; below.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = p.items.map((it, idx) => {
    const productOptions = '<option value="">— pick product —</option>' +
      state.companies.map(co => {
        const coProds = state.products.filter(prod => prod.company_id === co.id);
        if (!coProds.length) return '';
        return `<optgroup label="${co.code}">${
          coProds.map(prod => `<option value="${prod.id}" ${it.product_id === prod.id ? 'selected' : ''}>${prod.name}</option>`).join('')
        }</optgroup>`;
      }).join('');

    if (state.handwrite) {
      if (!it.lots || it.lots.length === 0) it.lots = [makeLot()];
      if (it.lots.length > 1) it.lots = [it.lots[0]];
      const hl = it.lots[0];
      const rateCell = isLocal
        ? `<td><input type="number" step="0.01" min="0" value="${it.packing_size_kg && it.rate_per_bag ? ((it.rate_per_bag * 100) / Number(it.packing_size_kg)).toFixed(2) : ''}"
            placeholder="₹/qtl"
            oninput="updateItemRate('${partyId}','${it.id}',this.value)"
            style="border-color:var(--gold);background:rgba(176,133,69,.06)"></td>`
        : '';
      return `<tr data-item="${it.id}" class="product-row">
        <td style="text-align:center;color:var(--ink);font-size:13px;font-weight:600">${idx + 1}</td>
        <td><select onchange="onProductPick('${partyId}','${it.id}',this.value)">${productOptions}</select></td>
        <td><input type="text" value="${escapeAttr(it.lot_prefix || '')}" placeholder="Lot prefix…"
          oninput="updateLotPrefix('${partyId}','${it.id}',this.value)"
          style="font-family:'JetBrains Mono',monospace;font-size:11px;width:100%"></td>
        <td><input type="number" value="${it.packing_size_kg}" readonly tabindex="-1"
          style="background:var(--line-soft);color:var(--ink-soft);cursor:not-allowed"></td>
        <td><input type="number" step="1" min="0" value="${hl.bags}"
          data-party="${partyId}" data-item="${it.id}" data-lot="${hl.id}" data-field="bags" class="num-wheel"
          oninput="onLotBagsChange('${partyId}','${it.id}','${hl.id}',this.value)"></td>
        <td><input type="number" step="0.01" min="0" value="${hl.qty_qtl}"
          data-party="${partyId}" data-item="${it.id}" data-lot="${hl.id}" data-field="qty_qtl" class="num-wheel"
          oninput="onLotQtyChange('${partyId}','${it.id}','${hl.id}',this.value)"></td>
        ${rateCell}
        <td><button class="btn btn-sm btn-icon" onclick="delItem('${partyId}','${it.id}')" title="Remove">&times;</button></td>
      </tr>`;
    }

    const productLots = it.product_id
      ? state.lots.filter(l => l.product_id === it.product_id && l.active !== false)
      : [];

    const groupBags = it.lots.reduce((s, l) => s + (Number(l.bags) || 0), 0);
    const groupQty  = it.lots.reduce((s, l) => s + (Number(l.qty_qtl) || 0), 0);
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
          <select onchange="updateLot('${partyId}','${it.id}','${lot.id}','lot_id',this.value)">${lotOptions}</select>
          ${selectedLot ? `<div class="stock-hint ${overflow ? 'stock-warn' : ''}">${selectedLot.bags_available} in stock${overflow ? ' — OVER!' : ''}</div>` : ''}
        </td>
        <td></td>
        <td><input type="number" step="1" min="0" value="${lot.bags}"
          data-party="${partyId}" data-item="${it.id}" data-lot="${lot.id}" data-field="bags" class="num-wheel"
          oninput="onLotBagsChange('${partyId}','${it.id}','${lot.id}',this.value)"></td>
        <td><input type="number" step="0.01" min="0" value="${lot.qty_qtl}"
          data-party="${partyId}" data-item="${it.id}" data-lot="${lot.id}" data-field="qty_qtl" class="num-wheel"
          oninput="onLotQtyChange('${partyId}','${it.id}','${lot.id}',this.value)"></td>
        <td><button class="btn btn-sm btn-icon" onclick="delLot('${partyId}','${it.id}','${lot.id}')" title="Remove lot">&times;</button></td>
      </tr>`;
    }).join('');

    return `<tr data-item="${it.id}" class="product-row">
      <td style="text-align:center;color:var(--ink);font-size:13px;font-weight:600">${idx + 1}</td>
      <td><select onchange="onProductPick('${partyId}','${it.id}',this.value)">${productOptions}</select></td>
      <td style="font-size:11px;color:var(--muted)">${it.lots.length > 1 ? it.lots.length + ' lots' : '—'}</td>
      <td><input type="number" value="${it.packing_size_kg}" readonly tabindex="-1"
        style="background:var(--line-soft);color:var(--ink-soft);cursor:not-allowed"></td>
      <td style="font-weight:600">${groupBags || ''}</td>
      <td style="font-weight:600">${groupQty ? groupQty.toFixed(2) : ''}</td>
      <td><button class="btn btn-sm btn-icon" onclick="delItem('${partyId}','${it.id}')" title="Remove">&times;</button></td>
    </tr>${lotRows}
    <tr class="lot-row-add"><td></td><td colspan="6" style="padding-top:0">
      <button class="btn btn-sm" onclick="addLotToItem('${partyId}','${it.id}')" ${!it.product_id ? 'disabled' : ''}>+ Add another lot</button>
    </td></tr>`;
  }).join('');
}

function onProductPick(partyId, itemId, productId) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  const it = p.items.find(i => i.id === itemId);
  if (!it) return;
  it.product_id = productId;
  const product = state.products.find(prod => prod.id === productId);
  if (product) {
    it.company_id = product.company_id;
    it.packing_size_kg = product.packing_size_kg;
    it.rate_per_bag = product.rate_per_bag;
  } else { it.company_id = ''; it.packing_size_kg = ''; it.rate_per_bag = 0; }
  it.lots = [makeLot()];
  renderPartyItems(partyId);
  updateTotals();
}

function updateLot(partyId, itemId, lotRowId, field, value) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  const it = p.items.find(i => i.id === itemId);
  if (!it) return;
  const lot = it.lots.find(l => l.id === lotRowId);
  if (!lot) return;
  lot[field] = value;
  if (field === 'lot_id') { lot.bags = ''; lot.qty_qtl = ''; }
  renderPartyItems(partyId);
  updateTotals();
}

function siblingLotInput(partyId, itemId, lotRowId, otherField) {
  return document.querySelector(`input.num-wheel[data-party="${partyId}"][data-item="${itemId}"][data-lot="${lotRowId}"][data-field="${otherField}"]`);
}

function refreshLotStockHint(partyId, itemId, lotRowId) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  const it = p.items.find(i => i.id === itemId);
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

function refreshGroupTotals(partyId, itemId) {
  if (state.handwrite) return;
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  const it = p.items.find(i => i.id === itemId);
  if (!it) return;
  const groupBags = it.lots.reduce((s, l) => s + (Number(l.bags) || 0), 0);
  const groupQty  = it.lots.reduce((s, l) => s + (Number(l.qty_qtl) || 0), 0);
  const headerRow = document.querySelector(`tr.product-row[data-item="${itemId}"]`);
  if (!headerRow) return;
  const cells = headerRow.querySelectorAll('td');
  if (cells[4]) cells[4].textContent = groupBags || '';
  if (cells[5]) cells[5].textContent = groupQty ? groupQty.toFixed(2) : '';
}

function onLotBagsChange(partyId, itemId, lotRowId, value) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  const it = p.items.find(i => i.id === itemId);
  if (!it) return;
  const lot = it.lots.find(l => l.id === lotRowId);
  if (!lot) return;
  lot.bags = value;
  lot.qty_qtl = ((Number(value) * Number(it.packing_size_kg)) / 100).toFixed(2);
  const qtyEl = siblingLotInput(partyId, itemId, lotRowId, 'qty_qtl');
  if (qtyEl) qtyEl.value = lot.qty_qtl;
  refreshLotStockHint(partyId, itemId, lotRowId);
  refreshGroupTotals(partyId, itemId);
  updateTotals();
}

function onLotQtyChange(partyId, itemId, lotRowId, value) {
  const p = state.parties.find(x => x.id === partyId);
  if (!p) return;
  const it = p.items.find(i => i.id === itemId);
  if (!it) return;
  const lot = it.lots.find(l => l.id === lotRowId);
  if (!lot) return;
  const pack = Number(it.packing_size_kg) || 0;
  if (pack > 0) {
    const wholeBags = Math.ceil((Number(value) * 100) / pack);
    lot.bags = wholeBags;
    lot.qty_qtl = ((wholeBags * pack) / 100).toFixed(2);
  } else {
    lot.qty_qtl = value;
  }
  const bagsEl = siblingLotInput(partyId, itemId, lotRowId, 'bags');
  if (bagsEl) bagsEl.value = lot.bags;
  const qtyEl = siblingLotInput(partyId, itemId, lotRowId, 'qty_qtl');
  if (qtyEl) qtyEl.value = lot.qty_qtl;
  refreshLotStockHint(partyId, itemId, lotRowId);
  refreshGroupTotals(partyId, itemId);
  updateTotals();
}

document.addEventListener('wheel', function(e) {
  const el = document.activeElement;
  if (!el || !el.classList.contains('num-wheel')) return;
  if (el !== e.target && !el.contains(e.target)) return;

  e.preventDefault();
  const partyId = el.dataset.party;
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
    onLotBagsChange(partyId, itemId, lotRowId, rounded);
  } else {
    onLotQtyChange(partyId, itemId, lotRowId, rounded);
  }
}, { passive: false });

function updateTotals() {
  let totalBags = 0, totalQty = 0, totalVal = 0;
  for (const party of state.parties) {
    for (const it of party.items) {
      const rate = Number(it.rate_per_bag) || 0;
      for (const lot of it.lots) {
        totalBags += Number(lot.bags) || 0;
        totalQty  += Number(lot.qty_qtl) || 0;
        totalVal  += (Number(lot.bags) || 0) * rate;
      }
    }
  }
  $('tot-bags').textContent = totalBags.toLocaleString('en-IN');
  $('tot-qty').textContent = totalQty.toFixed(2);
  $('tot-val').textContent = fmtIN(totalVal);
}

function clearBatch() {
  if (!confirm(state.editingChallanId ? 'Cancel edit and clear the form?' : 'Clear all parties and start a new truck run?')) return;
  state.editingChallanId = null;
  state.editingDcNumber = null;
  state.editingCompanyId = null;
  state.editingOriginalItems = [];
  state.handwrite = false;
  state.challanType = 'regular';
  $('f-handwrite').checked = false;
  $('edit-banner').style.display = 'none';
  $('save-btn').textContent = 'Generate All DCs';
  $('f-lorry').value = '';
  $('f-transport').value = 'Singh Golden Transportation';
  state.parties = [makeParty()];
  renderParties();
  renderChallanTypeToggle();
  updateTotals();
}

// ============================================================
// VALIDATION & SAVE
// ============================================================
function validateBatch() {
  const errs = [];
  if (state.parties.length === 0) errs.push('Add at least one party.');
  const lotDemand = new Map();
  const isLocal = state.challanType === 'local';

  for (const [pi, party] of state.parties.entries()) {
    const pn = pi + 1;

    if (isLocal) {
      // Local farmer: just need a name
      if (!party.farmer_name || !party.farmer_name.trim()) errs.push(`Party ${pn}: enter a farmer name.`);
    } else {
      if (!party.dist_id) errs.push(`Party ${pn}: pick a distributor.`);
      if (!party.ship_to_dist && !party.ret_id) errs.push(`Party ${pn}: pick a retailer or enable "Same as distributor".`);
    }

    if (party.items.length === 0) errs.push(`Party ${pn}: add at least one item.`);

    for (const [i, it] of party.items.entries()) {
      const n = `P${pn}-Item${i + 1}`;
      if (!it.product_id) { errs.push(`${n}: pick a product`); continue; }
      if (!(Number(it.packing_size_kg) > 0)) errs.push(`${n}: packing size > 0`);
      if (state.handwrite) {
        const hl = (it.lots && it.lots[0]) || null;
        if (!hl || !(Number(hl.bags) > 0)) errs.push(`${n}: bags > 0`);
        continue;
      }
      if (!it.lots || it.lots.length === 0) { errs.push(`${n}: add at least one lot`); continue; }
      for (const [j, lot] of it.lots.entries()) {
        const ln = j + 1;
        if (!lot.lot_id)                errs.push(`${n} lot ${ln}: pick a lot`);
        if (!(Number(lot.bags) > 0))    errs.push(`${n} lot ${ln}: bags > 0`);
        if (!(Number(lot.qty_qtl) > 0)) errs.push(`${n} lot ${ln}: qty > 0`);
        if (lot.lot_id) lotDemand.set(lot.lot_id, (lotDemand.get(lot.lot_id) || 0) + (Number(lot.bags) || 0));
      }
    }
  }

  const editAllocated = new Map();
  if (state.editingChallanId) {
    for (const orig of state.editingOriginalItems)
      editAllocated.set(orig.lot_id, (editAllocated.get(orig.lot_id) || 0) + orig.bags);
  }

  for (const [lotId, demand] of lotDemand.entries()) {
    const stock = state.lots.find(l => l.id === lotId);
    const available = (stock?.bags_available || 0) + (editAllocated.get(lotId) || 0);
    if (stock && demand > available)
      errs.push(`Lot ${stock.lot_number}: requested ${demand} bags, only ${available} available`);
  }
  return errs;
}

function buildChallansData() {
  const common = {
    dc_date: $('f-date').value,
    lorry_no: $('f-lorry').value.trim(),
    transport: $('f-transport').value.trim(),
    freight_status: $('f-freight').value,
    handwrite: state.handwrite,
    challan_type: state.challanType,
  };

  const isLocal = state.challanType === 'local';
  const allChallans = [];

  for (const party of state.parties) {
    // Build a "distributor-like" object for farmer parties so the print template works
    let dist, ret;
    if (isLocal) {
      dist = {
        id: null,
        name: party.farmer_name || '',
        address: party.farmer_village || '',
        city: party.farmer_village || '',
        phone: party.farmer_phone || '',
        gstin: null,
      };
      ret = null;
    } else {
      dist = state.distributors.find(d => d.id === party.dist_id);
      ret  = party.ship_to_dist ? null : state.retailers.find(r => r.id === party.ret_id);
      if (!dist || (!ret && !party.ship_to_dist)) continue;
    }

    const byCompany = new Map();
    party.items.forEach(it => {
      if (!it.company_id) return;
      if (!byCompany.has(it.company_id)) byCompany.set(it.company_id, []);
      byCompany.get(it.company_id).push(it);
    });

    for (const [coId, items] of byCompany.entries()) {
      const co = state.companies.find(c => c.id === coId);
      const mappedItems = items.map((it, idx) => {
        const product = state.products.find(p => p.id === it.product_id);
        return {
          position: idx + 1,
          product_id: it.product_id,
          product_name: product?.name || '',
          lot_prefix: it.lot_prefix || '',
          packing_size_kg: Number(it.packing_size_kg),
          rate_per_bag: Number(it.rate_per_bag) || 0,
          lots: it.lots.map(lot => {
            const stock = state.lots.find(l => l.id === lot.lot_id);
            return { lot_id: lot.lot_id, lot_number: stock?.lot_number || '', bags: Number(lot.bags), qty_qtl: Number(lot.qty_qtl) };
          }),
        };
      });
      const totalBags  = mappedItems.reduce((s, it) => s + it.lots.reduce((ss, l) => ss + (Number(l.bags) || 0), 0), 0);
      const totalQty   = mappedItems.reduce((s, it) => s + it.lots.reduce((ss, l) => ss + (Number(l.qty_qtl) || 0), 0), 0);
      const totalValue = mappedItems.reduce((s, it) => {
        const rate = Number(it.rate_per_bag) || 0;
        return s + it.lots.reduce((ss, l) => ss + (Number(l.bags) || 0) * rate, 0);
      }, 0);
      allChallans.push({
        ...common,
        company: co,
        distributor: dist,
        retailer: ret,
        ship_to_dist: isLocal ? false : (party.ship_to_dist || false),
        farmer_name: isLocal ? party.farmer_name : null,
        farmer_village: isLocal ? party.farmer_village : null,
        farmer_phone: isLocal ? party.farmer_phone : null,
        items: mappedItems,
        total_bags: totalBags,
        total_qty_qtl: totalQty,
        total_value: totalValue,
      });
    }
  }
  return allChallans;
}

async function saveChallan() {
  if (state.demoMode) { await saveChallanDemo(); return; }
  const errs = validateBatch();
  if (errs.length) { toast(errs[0], true); return; }

  const btn = $('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const withTimeout = (promise, label, ms = 60000) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms/1000}s — check network / Supabase RLS`)), ms)
      ),
    ]);

  try {
    const challansToSave = buildChallansData();
    if (!challansToSave.length) { toast('No items with a product selected', true); return; }

    // ── EDIT MODE ────────────────────────────────────────────────
    if (state.editingChallanId) {
      const editD = challansToSave.find(c => c.company.id === state.editingCompanyId);

      if (editD) {
        for (const orig of state.editingOriginalItems) {
          const { data: lotRow } = await withTimeout(
            sb.from('product_lots').select('bags_available').eq('id', orig.lot_id).single(), 'Read stock');
          if (lotRow) {
            await withTimeout(
              sb.from('product_lots').update({ bags_available: lotRow.bags_available + orig.bags }).eq('id', orig.lot_id),
              'Restore stock');
          }
        }

        const { error: delErr } = await withTimeout(
          sb.from('challan_items').delete().eq('challan_id', state.editingChallanId), 'Delete old items');
        if (delErr) throw delErr;

        const { error: updErr } = await withTimeout(
          sb.from('challans').update({
            dc_date:        editD.dc_date,
            distributor_id: editD.distributor?.id || null,
            retailer_id:    editD.retailer?.id || null,
            farmer_name:    editD.farmer_name || null,
            farmer_village: editD.farmer_village || null,
            farmer_phone:   editD.farmer_phone || null,
            lorry_no:       editD.lorry_no || null,
            transport:      editD.transport || null,
            freight_status: editD.freight_status,
            total_bags:     editD.total_bags,
            total_qty_qtl:  editD.total_qty_qtl,
            total_value:    editD.total_value,
          }).eq('id', state.editingChallanId), 'Update challan');
        if (updErr) throw updErr;

        let pos = 1;
        const newRows = [];
        for (const it of editD.items) {
          for (const lot of it.lots) {
            newRows.push({
              challan_id:      state.editingChallanId,
              position:        pos++,
              product_id:      it.product_id,
              product_name:    it.product_name,
              lot_id:          editD.handwrite ? null : (lot.lot_id || null),
              lot_number:      editD.handwrite ? (it.lot_prefix || '') : lot.lot_number,
              packing_size_kg: Number(it.packing_size_kg),
              bags:            Number(lot.bags),
              qty_qtl:         Number(lot.qty_qtl),
              rate_per_bag:    Number(it.rate_per_bag) || 0,
              line_value:      Number(lot.bags) * (Number(it.rate_per_bag) || 0),
            });
          }
        }
        const { error: itErr } = await withTimeout(sb.from('challan_items').insert(newRows), 'Insert new items');
        if (itErr) throw itErr;

        if (!editD.handwrite) {
          const deductByLot = new Map();
          for (const it of editD.items)
            for (const lot of it.lots)
              deductByLot.set(lot.lot_id, (deductByLot.get(lot.lot_id) || 0) + Number(lot.bags));
          for (const [lotId, bags] of deductByLot.entries()) {
            const { error: allocErr } = await withTimeout(
              sb.rpc('allocate_stock', { p_lot_id: lotId, p_bags: bags }), 'Deduct stock');
            if (allocErr) throw allocErr;
          }
        }

        await withTimeout(loadAllData(), 'Reload data', 20000);
        const dcLabel = formatDcNumber(state.editingDcNumber, state.challanType);
        showChallanPreview([{ ...editD, dc_number: state.editingDcNumber }]);
        toast(`${editD.company.code}-${dcLabel} updated!`);
        state.editingChallanId = null;
        state.editingDcNumber = null;
        state.editingCompanyId = null;
        state.editingOriginalItems = [];
        $('edit-banner').style.display = 'none';
        $('save-btn').textContent = 'Generate All DCs';
        state.parties = [makeParty()];
        renderParties();
        updateTotals();
        return;
      }

      // Company changed path
      for (const orig of state.editingOriginalItems) {
        const { data: lotRow } = await withTimeout(
          sb.from('product_lots').select('bags_available').eq('id', orig.lot_id).single(), 'Read stock');
        if (lotRow) {
          await withTimeout(
            sb.from('product_lots').update({ bags_available: lotRow.bags_available + orig.bags }).eq('id', orig.lot_id),
            'Restore stock');
        }
      }
      const { error: delChErr } = await withTimeout(
        sb.from('challans').delete().eq('id', state.editingChallanId), 'Delete old challan');
      if (delChErr) throw delChErr;
      const { data: maxRow } = await sb.from('challans')
        .select('dc_number').eq('company_id', state.editingCompanyId)
        .order('dc_number', { ascending: false }).limit(1).single();
      await sb.from('companies')
        .update({ next_dc_number: maxRow ? maxRow.dc_number + 1 : 1 })
        .eq('id', state.editingCompanyId);
      state.editingChallanId = null;
      state.editingDcNumber = null;
      state.editingCompanyId = null;
      state.editingOriginalItems = [];
      $('edit-banner').style.display = 'none';
      $('save-btn').textContent = 'Generate All DCs';
    }
    // ── END EDIT MODE ─────────────────────────────────────────────

    const savedChallans = [];
    const isLocal = state.challanType === 'local';

    for (const d of challansToSave) {
      // Get next DC number — local type uses next_local_dc_number function
      const rpcName = isLocal ? 'next_local_dc_number' : 'next_dc_number';
      const { data: nextDc, error: dcErr } = await withTimeout(
        sb.rpc(rpcName, { p_company_id: d.company.id }), 'Get DC number');
      if (dcErr) throw dcErr;

      const { data: ch, error: chErr } = await withTimeout(
        sb.from('challans').insert({
          dc_number:      nextDc,
          challan_type:   d.challan_type,
          company_id:     d.company.id,
          dc_date:        d.dc_date,
          distributor_id: d.distributor?.id || null,
          retailer_id:    d.retailer?.id || null,
          farmer_name:    d.farmer_name || null,
          farmer_village: d.farmer_village || null,
          farmer_phone:   d.farmer_phone || null,
          lorry_no:       d.lorry_no || null,
          transport:      d.transport || null,
          freight_status: d.freight_status,
          total_bags:     d.total_bags,
          total_qty_qtl:  d.total_qty_qtl,
          total_value:    d.total_value,
          created_by:     state.user.id,
        }).select().single(), 'Insert challan');
      if (chErr) throw chErr;

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
            lot_number:      d.handwrite ? (it.lot_prefix || '') : lot.lot_number,
            packing_size_kg: Number(it.packing_size_kg),
            bags:            Number(lot.bags),
            qty_qtl:         Number(lot.qty_qtl),
            rate_per_bag:    Number(it.rate_per_bag) || 0,
            line_value:      Number(lot.bags) * (Number(it.rate_per_bag) || 0),
          });
        }
      }
      const { error: itErr } = await withTimeout(sb.from('challan_items').insert(itemRows), 'Insert items');
      if (itErr) throw itErr;

      if (!d.handwrite) {
        const deductByLot = new Map();
        for (const it of d.items)
          for (const lot of it.lots)
            deductByLot.set(lot.lot_id, (deductByLot.get(lot.lot_id) || 0) + Number(lot.bags));
        for (const [lotId, bags] of deductByLot.entries()) {
          const { error: allocErr } = await withTimeout(
            sb.rpc('allocate_stock', { p_lot_id: lotId, p_bags: bags }), 'Deduct stock');
          if (allocErr) throw allocErr;
        }
      }

      savedChallans.push({ ...d, dc_number: nextDc });
    }

    await withTimeout(loadAllData(), 'Reload data', 20000);
    showChallanPreview(savedChallans);

    const labels = savedChallans.map(d => `${d.company.code}-${formatDcNumber(d.dc_number, d.challan_type)}`).join(' + ');
    toast(`${labels} saved!`);

    state.parties = [makeParty()];
    renderParties();
    updateTotals();

  } catch (e) {
    console.error('[save] FAILED:', e);
    toast('Save failed: ' + (e.message || e), true);
  } finally {
    btn.disabled = false;
    btn.textContent = state.editingChallanId ? 'Update DC' : 'Generate All DCs';
  }
}

// ============================================================
// CHALLAN PREVIEW
// ============================================================
function previewChallan() {
  const errs = validateBatch();
  if (errs.length) { toast(errs[0], true); return; }
  const challans = buildChallansData();
  if (!challans.length) { toast('Add items and pick products first', true); return; }
  challans.forEach(d => { d.dc_number = state.editingDcNumber || '(preview)'; });
  showChallanPreview(challans);
}

function showChallanPreview(d) {
  const arr = Array.isArray(d) ? d : [d];
  const html = arr.map((item, i) =>
    (i > 0 ? '<div style="margin-top:36px;padding-top:36px;border-top:2px dashed #bbb"></div>' : '') +
    buildChallanHTML(item)
  ).join('');
  $('modal-body').innerHTML = html;
  $('preview-modal').classList.add('open');
}

function closeModal() {
  $('preview-modal').classList.remove('open');
}

async function buildChallanPdf(targets) {
  if (!targets.length) throw new Error('Nothing to print');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const names = [];

  for (let i = 0; i < targets.length; i++) {
    if (i > 0) pdf.addPage();
    const canvas = await html2canvas(targets[i], { scale: 2, backgroundColor: '#fff' });
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const imgW = pageW - 20;
    const imgH = (canvas.height * imgW) / canvas.width;
    pdf.addImage(imgData, 'JPEG', 10, 10, imgW, Math.min(imgH, pageH - 20));
    names.push(targets[i].querySelector('.cp-refs .rv')?.textContent || 'DC');
  }
  return { pdf, names };
}

async function printChallans() {
  const targets = Array.from(document.querySelectorAll('#modal-body .cp'));
  if (!targets.length) { toast('Nothing to print', true); return; }
  toast('Preparing print…');
  try {
    const { pdf } = await buildChallanPdf(targets);
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'width=900,height=700');
    if (!win) {
      URL.revokeObjectURL(url);
      toast('Popup blocked — allow popups for this page and try again', true);
      return;
    }
    const cleanup = () => { try { URL.revokeObjectURL(url); } catch (_) {} };
    win.addEventListener('afterprint', cleanup, { once: true });
    win.addEventListener('beforeunload', cleanup, { once: true });
    setTimeout(() => {
      try { win.focus(); win.print(); }
      catch (e) { cleanup(); toast('Print failed: ' + e.message, true); }
    }, 1200);
  } catch (e) {
    toast('Print error: ' + e.message, true);
  }
}

async function downloadPDF() {
  const targets = Array.from(document.querySelectorAll('#modal-body .cp'));
  if (!targets.length) { toast('Nothing to download', true); return; }
  toast('Generating PDF…');
  try {
    const { pdf, names } = await buildChallanPdf(targets);
    pdf.save(`${names.join('_')}.pdf`);
  } catch (e) {
    toast('PDF error: ' + e.message, true);
  }
}

function n2w(num) {
  if (!num || num === 0) return 'Zero Rupees Only';
  const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function two(n) { if (n < 20) return a[n]; return b[Math.floor(n/10)] + (n%10 ? ' ' + a[n%10] : ''); }
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
  const isAsian = co.code === 'ASIAN' || co.code === 'ASE';
  const isLocal = d.challan_type === 'local';

  const displayName = (name) =>
    (name || '').replace(/\s+(Certified|Research|Foundation|Truthful(?:ly Labelled)?)\s+Seeds\s*$/i, '').trim();

  const HW_TOTAL_WRITE_PX = 560;
  const hwCount = Math.max(1, d.items.length);
  const hwPerRow = Math.floor(HW_TOTAL_WRITE_PX / hwCount);

  const itemRows = d.items.map((it, i) => {
    if (d.handwrite) {
      const groupBags = it.lots.reduce((s, l) => s + Number(l.bags || 0), 0);
      const groupQty  = it.lots.reduce((s, l) => s + Number(l.qty_qtl || 0), 0);
      return `<tr>
        <td style="text-align:center;vertical-align:top;padding-top:8px">${i + 1}</td>
        <td style="vertical-align:top;padding-top:8px;font-size:13.5px;font-weight:600">${displayName(it.product_name)}</td>
        <td style="vertical-align:top;padding-top:6px">
          ${it.lot_prefix ? `<span style="font-family:'Inter',monospace;font-size:11px;font-weight:600">${it.lot_prefix}</span>` : ''}
          <div style="height:${hwPerRow - (it.lot_prefix ? 20 : 0)}px"></div>
        </td>
        <td style="text-align:center;vertical-align:top;padding-top:8px">${it.packing_size_kg}</td>
        <td style="text-align:center;vertical-align:top;padding-top:8px;font-weight:700">${groupBags || ''}</td>
        <td style="text-align:center;vertical-align:top;padding-top:8px;font-weight:700">${groupQty ? groupQty.toFixed(2) : ''}</td>
      </tr>`;
    }

    const isMulti = it.lots.length > 1;
    const lotNumbersHtml = it.lots.map(l => l.lot_number).join('<br>');
    const bagsHtml = it.lots.map(l => l.bags).join('<br>');
    const qtyHtml  = it.lots.map(l => Number(l.qty_qtl).toFixed(2)).join('<br>');
    const groupBags = it.lots.reduce((s, l) => s + Number(l.bags || 0), 0);
    const groupQty  = it.lots.reduce((s, l) => s + Number(l.qty_qtl || 0), 0);

    return `<tr>
      <td style="text-align:center;vertical-align:top">${i + 1}</td>
      <td style="vertical-align:top;font-size:13.5px;font-weight:600">${displayName(it.product_name)}${isMulti ? `<div style="font-size:9px;color:#555;margin-top:2px">(across ${it.lots.length} lots)</div>` : ''}</td>
      <td style="font-family:'Inter',sans-serif;font-size:11px;line-height:1.5;vertical-align:top">${lotNumbersHtml}</td>
      <td style="text-align:center;vertical-align:top">${it.packing_size_kg}</td>
      <td style="text-align:center;line-height:1.5;vertical-align:top">${bagsHtml}${isMulti ? `<div style="margin-top:3px;border-top:1px solid #000;padding-top:2px;font-weight:700">${groupBags}</div>` : ''}</td>
      <td style="text-align:center;line-height:1.5;vertical-align:top">${qtyHtml}${isMulti ? `<div style="margin-top:3px;border-top:1px solid #000;padding-top:2px;font-weight:700">${groupQty.toFixed(2)}</div>` : ''}</td>
    </tr>`;
  }).join('');

  const logoHtml = co.logo_url
    ? `<img src="${co.logo_url}" alt="${co.name}">`
    : `<div style="font-family:Fraunces,serif;font-size:24px;font-weight:700;opacity:.3">${co.code}</div>`;

  // Formatted DC number (L-01 for local, plain number for regular)
  const dcDisplay = d.dc_number === '(preview)' ? '(preview)' : formatDcNumber(d.dc_number, d.challan_type);

  // Bill-to and Deliver-to boxes differ for local farmer challans
  const billToBox = isLocal ? `
    <div class="cp-box">
      <div class="bt"><strong>Sold To (Farmer):</strong></div>
      <div class="bv">${d.farmer_name || d.distributor?.name || '—'}</div>
      <div class="bs">${d.farmer_village || d.distributor?.address || ''}</div>
      <div class="bx">${d.farmer_phone ? 'Ph: ' + d.farmer_phone : ''}</div>
    </div>
  ` : `
    <div class="cp-box">
      <div class="bt">${isAsian ? 'Party TIN No.' : 'Party GSTIN'}: ${d.distributor.gstin || '—'}</div>
      <div class="bt" style="margin-top:4px"><strong>M/s (Bill To):</strong></div>
      <div class="bv">${d.distributor.name}</div>
      <div class="bs">${d.distributor.address || ''}</div>
      <div class="bx">${d.distributor.city || ''}</div>
    </div>
  `;

  const deliverToBox = isLocal ? `
    <div class="cp-box">
      <div class="bt"><strong>Delivery To (Farm / Village):</strong></div>
      <div class="bv">${d.farmer_village || d.farmer_name || '—'}</div>
      <div class="bs">&nbsp;</div>
    </div>
  ` : `
    <div class="cp-box">
      <div class="bt"><strong>Delivery To:</strong></div>
      <div class="bv">${d.ship_to_dist ? d.distributor.name : d.retailer.name}</div>
      <div class="bs">${d.ship_to_dist ? (d.distributor.address || '') : (d.retailer.address || '')}</div>
      <div class="bx">${d.ship_to_dist ? (d.distributor.city || '') : (d.retailer.city || '')}${(!d.ship_to_dist && d.retailer?.phone) ? ' &nbsp; · &nbsp; Ph: ' + d.retailer.phone : ''}</div>
    </div>
  `;

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
        <div class="ct">${isLocal ? 'Local Sale / Farmer Challan' : 'Delivery Challan / Transit Invoice'}</div>
      </div>
    </div>

    <div class="cp-refs">
      <div class="cp-ref"><div class="rl">DC No.</div><div class="rv">${dcDisplay}</div></div>
      <div class="cp-ref"><div class="rl">DC Date</div><div class="rv">${fmtDMY(d.dc_date)}</div></div>
      <div class="cp-ref"><div class="rl">Lorry No.</div><div class="rv">${d.lorry_no || '—'}</div></div>
      <div class="cp-ref"><div class="rl">Transport</div><div class="rv">${d.transport || '—'}</div></div>
    </div>

    <div class="cp-bil">
      ${billToBox}
      ${deliverToBox}
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
      <tbody>${itemRows}${d.handwrite ? '' : '<tr class="cp-spacer"><td></td><td></td><td></td><td></td><td></td><td></td></tr>'}</tbody>
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
      <div>• E-Invoice not required on Seed Quality (Exempted) goods — S.No. 59, Notification No. 2/2017 dt. 28.06.2017.</div>
      <div>• 18% interest will be charged on all accounts not settled.</div>
      <div>• All Subject to INDORE Jurisdiction.</div>
    </div>

    <div class="cp-sign">
      <div class="cp-sb">${isLocal ? "Farmer's Signature" : "Customer's Signature"}</div>
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
// TABS
// ============================================================
function showTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  $('panel-' + name).classList.add('active');
  localStorage.setItem('activeTab', name);

  loadAllData().then(() => {
    if (name === 'register') renderRegister();
    else if (name === 'master') renderMaster();
    else if (name === 'transfers') initTransferTab();
    else if (name === 'analytics') initAnalyticsTab();
    else if (name === 'batch') { renderParties(); updateTotals(); updateCompanyMeta(); renderChallanTypeToggle(); }
  });
}

function restoreTab() {
  const saved = localStorage.getItem('activeTab');
  if (!saved || saved === 'batch') return;
  const btn = document.querySelector(`.tab-btn[data-tab="${saved}"]`);
  if (btn) showTab(saved, btn);
}

// ============================================================
// REGISTER TAB
// ============================================================
const REG_PAGE_SIZE = 50;

async function renderRegister(resetPage = false) {
  if (state.demoMode) { renderRegisterDemo(); return; }
  const wrap = $('reg-table-wrap');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div> Loading register…</div>';

  const coFilter = $('reg-co-filter').value;
  const search = $('reg-search').value.trim().toLowerCase();
  // New: filter by challan type
  const typeFilter = $('reg-type-filter')?.value || '';

  let query = sb.from('challans').select(`
    id, dc_number, challan_type, dc_date, total_bags, total_qty_qtl, total_value, bill_no, lorry_no, lr_no, transport, freight_status,
    farmer_name, farmer_village,
    company:companies(id, code, name),
    distributor:distributors(id, name, city),
    retailer:retailers(id, name, city)
  `).order('dc_date', { ascending: false }).order('dc_number', { ascending: false });

  if (coFilter) {
    const co = state.companies.find(c => c.code === coFilter);
    if (co) query = query.eq('company_id', co.id);
  }
  if (typeFilter) query = query.eq('challan_type', typeFilter);

  const { data: challans, error } = await query;
  if (error) {
    wrap.innerHTML = '<div class="empty"><div class="empty-title">Failed to load</div>' + error.message + '</div>';
    return;
  }

  let filtered = challans || [];
  if (search) {
    filtered = filtered.filter(c => {
      const haystack = [
        c.dc_number, c.distributor?.name, c.retailer?.name,
        c.farmer_name, c.bill_no, c.lorry_no, c.transport,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }

  state.challans = filtered;
  if (resetPage) state.regPage = 0;
  state._pendingDeleteChallanId = state._pendingDeleteChallanId || null;
  _drawRegTable();
}

function goRegPage(n) {
  state.regPage = n;
  _drawRegTable();
}

function _drawRegTable() {
  const wrap = $('reg-table-wrap');
  const filtered = state.challans || [];

  if (filtered.length === 0) {
    wrap.innerHTML = '<div class="empty"><div class="empty-title">No challans yet</div>Create one in the New Batch tab.</div>';
    return;
  }

  const totalPages = Math.ceil(filtered.length / REG_PAGE_SIZE);
  const page = state.regPage || 0;
  const pageData = filtered.slice(page * REG_PAGE_SIZE, (page + 1) * REG_PAGE_SIZE);

  const pagBar = totalPages > 1 ? `
    <div class="reg-pagination">
      <button class="btn btn-sm" onclick="goRegPage(${page - 1})" ${page === 0 ? 'disabled' : ''}>← Prev</button>
      <span>Page ${page + 1} of ${totalPages} &nbsp;·&nbsp; ${filtered.length} challans</span>
      <button class="btn btn-sm" onclick="goRegPage(${page + 1})" ${page >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
    </div>` : '';

  wrap.innerHTML = `
    ${pagBar}
    <table class="reg-table">
      <thead>
        <tr>
          <th>Co.</th>
          <th>DC No.</th>
          <th>Type</th>
          <th>Date</th>
          <th>Bill To / Farmer</th>
          <th>Ship To</th>
          <th style="text-align:right">Bags</th>
          <th style="text-align:right">Qtl</th>
          <th style="text-align:right">Value (₹)</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${pageData.map(c => {
          const isLocal = c.challan_type === 'local';
          const dcDisplay = formatDcNumber(c.dc_number, c.challan_type);
          if (state._pendingDeleteChallanId === c.id) {
            return `<tr style="background:rgba(183,62,62,.04)">
              <td colspan="9" style="font-size:12px;color:var(--red);font-weight:600;padding:12px">
                Delete ${c.company?.code || ''}-${dcDisplay} (${isLocal ? c.farmer_name : c.distributor?.name || ''})? Stock will be restored. This cannot be undone.
              </td>
              <td style="text-align:right;white-space:nowrap;padding:8px 10px">
                <button class="btn btn-sm" onclick="cancelDeleteChallan()">Cancel</button>
                <button class="btn btn-sm btn-danger" style="margin-left:6px" onclick="confirmDeleteChallan('${c.id}')">Yes, delete</button>
              </td>
            </tr>`;
          }
          return `<tr>
            <td><span class="reg-co ${c.company?.code === 'ASIAN' ? 'asian' : 'asn'}">${c.company?.code || '—'}</span></td>
            <td class="reg-dcno">${c.company?.code || ''}-${dcDisplay}</td>
            <td><span style="font-size:10px;padding:2px 7px;border-radius:100px;background:${isLocal ? 'rgba(176,133,69,.15)' : 'rgba(45,107,60,.1)'};color:${isLocal ? '#6a4d20' : 'var(--green-deep)'};font-weight:600">${isLocal ? '🌾 Local' : 'Regular'}</span></td>
            <td>${fmt(c.dc_date)}</td>
            <td>${isLocal ? (c.farmer_name || '—') : (c.distributor?.name || '—')}</td>
            <td>${isLocal ? (c.farmer_village || '—') : (c.retailer?.name || '—')}</td>
            <td style="text-align:right">${c.total_bags}</td>
            <td style="text-align:right">${Number(c.total_qty_qtl).toFixed(2)}</td>
            <td style="text-align:right">${fmtIN(c.total_value)}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm" onclick="reprintChallan('${c.id}')">View</button>
              <button class="btn btn-sm" onclick="editChallan('${c.id}')" style="margin-left:4px">Edit</button>
              <button class="btn btn-sm btn-danger" onclick="promptDeleteChallan('${c.id}')" style="margin-left:4px">Delete</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    ${pagBar}`;
}

function promptDeleteChallan(id) {
  state._pendingDeleteChallanId = id;
  _drawRegTable();
}

function cancelDeleteChallan() {
  state._pendingDeleteChallanId = null;
  _drawRegTable();
}

async function confirmDeleteChallan(challanId) {
  if (state.demoMode) {
    state.demoChallans = state.demoChallans.filter(c => c.id !== challanId);
    state._pendingDeleteChallanId = null;
    toast('[DEMO] Challan deleted.');
    renderRegisterDemo();
    return;
  }
  const btn = document.querySelector('.btn-danger[onclick^="confirmDeleteChallan"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }

  try {
    const { data: items, error: fetchErr } = await sb.from('challan_items').select('lot_id, bags').eq('challan_id', challanId);
    if (fetchErr) throw fetchErr;

    const stockItems = (items || []).filter(r => r.lot_id != null);
    for (const row of stockItems) {
      const { data: lotRow } = await sb.from('product_lots').select('bags_available').eq('id', row.lot_id).single();
      if (lotRow) {
        await sb.from('product_lots').update({ bags_available: lotRow.bags_available + row.bags }).eq('id', row.lot_id);
      }
    }

    const { data: challanRow } = await sb.from('challans').select('company_id, challan_type').eq('id', challanId).single();
    const companyId = challanRow?.company_id;
    const challanType = challanRow?.challan_type || 'regular';

    const { error: delItemsErr } = await sb.from('challan_items').delete().eq('challan_id', challanId);
    if (delItemsErr) throw delItemsErr;

    const { error: delErr } = await sb.from('challans').delete().eq('id', challanId);
    if (delErr) throw delErr;

    // Reset the correct counter (regular or local)
    if (companyId) {
      const { data: maxRow } = await sb.from('challans')
        .select('dc_number')
        .eq('company_id', companyId)
        .eq('challan_type', challanType)
        .order('dc_number', { ascending: false })
        .limit(1).single();
      const nextDc = maxRow ? maxRow.dc_number + 1 : 1;
      const counterField = challanType === 'local' ? 'next_local_dc_number' : 'next_dc_number';
      await sb.from('companies').update({ [counterField]: nextDc }).eq('id', companyId);
    }

    toast('Challan deleted and stock restored.');
    state._pendingDeleteChallanId = null;
    await loadAllData();
    renderRegister();
  } catch (e) {
    toast('Delete failed: ' + (e.message || e), true);
    state._pendingDeleteChallanId = null;
    renderRegister();
  }
}

async function reprintChallan(challanId) {
  if (state.demoMode) {
    const dc = state.demoChallans.find(c => c.id === challanId);
    if (!dc) { toast('Challan not found', true); return; }
    showChallanPreview({ ...dc, ship_to_dist: !dc.retailer });
    return;
  }
  toast('Loading challan…');
  const { data: ch, error } = await sb.from('challans').select(`
    *,
    company:companies(*),
    distributor:distributors(*),
    retailer:retailers(*),
    items:challan_items(*)
  `).eq('id', challanId).single();

  if (error) { toast('Failed: ' + error.message, true); return; }

  const flat = (ch.items || []).sort((a, b) => a.position - b.position);
  const isHandwrite = flat.length > 0 && flat.every(r => r.lot_id == null);
  const isLocal = ch.challan_type === 'local';

  const groups = [];
  for (const row of flat) {
    const prev = groups[groups.length - 1];
    if (prev && prev.product_id === row.product_id) {
      prev.lots.push({ lot_id: row.lot_id, lot_number: isHandwrite ? '' : row.lot_number, bags: row.bags, qty_qtl: row.qty_qtl });
    } else {
      groups.push({
        product_id:      row.product_id,
        product_name:    row.product_name,
        packing_size_kg: row.packing_size_kg,
        rate_per_bag:    row.rate_per_bag,
        lot_prefix: isHandwrite ? (row.lot_number || '') : '',
        lots: [{ lot_id: row.lot_id, lot_number: isHandwrite ? '' : row.lot_number, bags: row.bags, qty_qtl: row.qty_qtl }],
      });
    }
  }

  // Build a farmer pseudo-distributor if this is a local challan
  const distObj = isLocal
    ? { id: null, name: ch.farmer_name || '—', address: ch.farmer_village || '', city: ch.farmer_village || '', phone: ch.farmer_phone || '', gstin: null }
    : ch.distributor;

  showChallanPreview({
    dc_number:      ch.dc_number,
    challan_type:   ch.challan_type || 'regular',
    company:        ch.company,
    distributor:    distObj,
    retailer:       ch.retailer,
    ship_to_dist:   !ch.retailer_id,
    farmer_name:    ch.farmer_name || null,
    farmer_village: ch.farmer_village || null,
    farmer_phone:   ch.farmer_phone || null,
    dc_date:        ch.dc_date,
    lorry_no:       ch.lorry_no,
    transport:      ch.transport,
    freight_status: ch.freight_status,
    total_bags:     ch.total_bags,
    total_qty_qtl:  ch.total_qty_qtl,
    total_value:    ch.total_value,
    handwrite:      isHandwrite,
    items:          groups,
  });
}

async function editChallan(challanId) {
  if (state.demoMode) { toast('Edit is not available in Demo Mode', true); return; }
  toast('Loading challan for edit…');
  const { data: ch, error } = await sb.from('challans').select(`
    *,
    company:companies(*),
    distributor:distributors(*),
    retailer:retailers(*),
    items:challan_items(*)
  `).eq('id', challanId).single();
  if (error) { toast('Failed to load: ' + error.message, true); return; }

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="batch"]').classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  $('panel-batch').classList.add('active');
  await loadAllData();

  state.editingChallanId = challanId;
  state.editingDcNumber = ch.dc_number;
  state.editingCompanyId = ch.company_id;
  state.editingOriginalItems = (ch.items || []).filter(r => r.lot_id != null);
  state.challanType = ch.challan_type || 'regular';

  $('f-date').value = ch.dc_date;
  $('f-lorry').value = ch.lorry_no || '';
  $('f-transport').value = ch.transport || '';
  $('f-freight').value = ch.freight_status || 'To Pay';

  const flat = (ch.items || []).sort((a, b) => a.position - b.position);
  const isHandwrite = flat.length > 0 && flat.every(r => r.lot_id == null);
  const isLocal = ch.challan_type === 'local';
  state.handwrite = isHandwrite;
  $('f-handwrite').checked = isHandwrite;

  const productGroups = [];
  for (const row of flat) {
    const prev = productGroups[productGroups.length - 1];
    if (prev && prev.product_id === row.product_id) {
      prev.lots.push({ id: Math.random().toString(36).slice(2), lot_id: row.lot_id || '', bags: row.bags, qty_qtl: row.qty_qtl });
    } else {
      const product = state.products.find(p => p.id === row.product_id);
      productGroups.push({
        id: Math.random().toString(36).slice(2),
        product_id: row.product_id || '',
        company_id: product?.company_id || '',
        packing_size_kg: row.packing_size_kg,
        rate_per_bag: row.rate_per_bag,
        lot_prefix: isHandwrite ? (row.lot_number || '') : '',
        lots: [{ id: Math.random().toString(36).slice(2), lot_id: row.lot_id || '', bags: row.bags, qty_qtl: row.qty_qtl }],
      });
    }
  }

  state.parties = [{
    id: Math.random().toString(36).slice(2),
    dist_id:       isLocal ? '' : (ch.distributor_id || ''),
    dist_name:     isLocal ? '' : (ch.distributor?.name || ''),
    ret_id:        isLocal ? '' : (ch.retailer_id || ''),
    ret_name:      isLocal ? '' : (ch.retailer?.name || ''),
    ship_to_dist:  isLocal ? false : !ch.retailer_id,
    farmer_name:   ch.farmer_name || '',
    farmer_village:ch.farmer_village || '',
    farmer_phone:  ch.farmer_phone || '',
    items: productGroups,
  }];

  renderChallanTypeToggle();
  renderParties();
  updateTotals();
  updateCompanyMeta();

  const dcLabel = formatDcNumber(ch.dc_number, ch.challan_type || 'regular');
  $('edit-banner').style.display = 'flex';
  $('edit-banner-dc').textContent = `${ch.company?.code}-${dcLabel}`;
  $('save-btn').textContent = 'Update DC';
}

function cancelEdit() {
  state.editingChallanId = null;
  state.editingDcNumber = null;
  state.editingCompanyId = null;
  state.editingOriginalItems = [];
  state.handwrite = false;
  state.challanType = 'regular';
  $('f-handwrite').checked = false;
  $('edit-banner').style.display = 'none';
  $('save-btn').textContent = 'Generate All DCs';
  state.parties = [makeParty()];
  renderParties();
  renderChallanTypeToggle();
  updateTotals();
  toast('Edit cancelled');
}

function exportRegisterExcel() {
  if (!state.challans || state.challans.length === 0) {
    toast('Nothing to export', true);
    return;
  }
  const rows = state.challans.map(c => ({
    Company:        c.company?.code || '',
    'DC No.':       `${c.company?.code}-${formatDcNumber(c.dc_number, c.challan_type)}`,
    Type:           c.challan_type === 'local' ? 'Local/Farmer' : 'Regular',
    Date:           fmt(c.dc_date),
    'Bill To / Farmer': c.challan_type === 'local' ? (c.farmer_name || '') : (c.distributor?.name || ''),
    'Village / Ship To': c.challan_type === 'local' ? (c.farmer_village || '') : (c.retailer?.name || ''),
    'Total Bags':   c.total_bags,
    'Total Qtl':    c.total_qty_qtl,
    'Value (₹)':   c.total_value,
    'Bill No.':     c.bill_no || '',
    'Lorry No.':    c.lorry_no || '',
    'LR No.':       c.lr_no || '',
    Transport:      c.transport || '',
    Freight:        c.freight_status || '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Register');
  XLSX.writeFile(wb, `challan-register-${fmt(new Date())}.xlsx`);
}

// ============================================================
// ANALYTICS TAB
// ============================================================
let _analyticsData   = null;
let _selectedDistId  = null;

async function initAnalyticsTab() {
  if (state.demoMode) {
    $('an-cards').innerHTML = '<div class="empty"><div class="empty-title">Not available in demo mode</div></div>';
    return;
  }
  $('an-cards').innerHTML = '<div style="padding:20px;color:var(--muted);font-size:13px">Loading…</div>';
  $('an-table-wrap').innerHTML = '';

  const { data, error } = await sb.from('challans').select(`
    id, dc_date, total_bags, total_qty_qtl, total_value, challan_type,
    company:companies(code),
    distributor:distributors(id, name, city)
  `).order('dc_date', { ascending: false });

  if (error) {
    $('an-cards').innerHTML = '<div class="empty"><div class="empty-title">Failed to load</div>' + error.message + '</div>';
    return;
  }

  _analyticsData = data || [];
  renderAnalytics();
}

function renderAnalytics() {
  if (!_analyticsData) return;

  const coFilter   = $('an-co').value;
  const fromFilter = $('an-from').value;
  const toFilter   = $('an-to').value;

  let rows = _analyticsData;
  if (coFilter)   rows = rows.filter(c => c.company?.code === coFilter);
  if (fromFilter) rows = rows.filter(c => c.dc_date >= fromFilter);
  if (toFilter)   rows = rows.filter(c => c.dc_date <= toFilter);

  const totalDCs   = rows.length;
  const totalBags  = rows.reduce((s, c) => s + (Number(c.total_bags)    || 0), 0);
  const totalQtl   = rows.reduce((s, c) => s + (Number(c.total_qty_qtl) || 0), 0);
  const totalValue = rows.reduce((s, c) => s + (Number(c.total_value)   || 0), 0);

  $('an-cards').innerHTML = `
    <div class="an-card">
      <div class="an-card-label">Total DCs</div>
      <div class="an-card-value">${totalDCs.toLocaleString('en-IN')}</div>
    </div>
    <div class="an-card">
      <div class="an-card-label">Total Bags</div>
      <div class="an-card-value">${totalBags.toLocaleString('en-IN')}</div>
    </div>
    <div class="an-card">
      <div class="an-card-label">Total Qtl</div>
      <div class="an-card-value">${totalQtl.toFixed(1)}</div>
      <div class="an-card-sub">quintals</div>
    </div>
    <div class="an-card">
      <div class="an-card-label">Total Value</div>
      <div class="an-card-value">₹${fmtIN(totalValue)}</div>
    </div>`;

  const distMap = new Map();
  for (const c of rows) {
    const key  = c.distributor?.id || '__none__';
    const name = c.distributor?.name || '(no distributor)';
    const city = c.distributor?.city || '';
    if (!distMap.has(key)) distMap.set(key, { id: key, name, city, dcs: 0, bags: 0, qtl: 0, value: 0 });
    const d = distMap.get(key);
    d.dcs++;
    d.bags  += Number(c.total_bags)    || 0;
    d.qtl   += Number(c.total_qty_qtl) || 0;
    d.value += Number(c.total_value)   || 0;
  }

  const sorted = [...distMap.values()].sort((a, b) => b.bags - a.bags);

  $('an-drilldown').style.display = 'none';
  _selectedDistId = null;

  $('an-table-wrap').innerHTML = sorted.length === 0
    ? '<div class="empty"><div class="empty-title">No data for selected filters</div></div>'
    : `<table class="an-table">
        <thead>
          <tr>
            <th>#</th><th>Distributor</th><th>City</th>
            <th style="text-align:right">DCs</th>
            <th style="text-align:right">Bags</th>
            <th style="text-align:right">Qtl</th>
            <th style="text-align:right">Value (₹)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((d, i) => `
            <tr class="an-dist-row" data-distid="${d.id}" onclick="selectDist('${d.id}')">
              <td class="an-rank">${i + 1}</td>
              <td style="font-weight:500">${d.name}</td>
              <td style="color:var(--muted)">${d.city || '—'}</td>
              <td style="text-align:right">${d.dcs}</td>
              <td style="text-align:right;font-weight:600">${d.bags.toLocaleString('en-IN')}</td>
              <td style="text-align:right">${d.qtl.toFixed(1)}</td>
              <td style="text-align:right">${fmtIN(d.value)}</td>
              <td style="color:var(--muted);font-size:11px">↓</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
}

async function selectDist(distId) {
  if (_selectedDistId === distId) {
    _selectedDistId = null;
    $('an-drilldown').style.display = 'none';
    document.querySelectorAll('.an-dist-row').forEach(tr => tr.classList.remove('an-dist-selected'));
    return;
  }

  _selectedDistId = distId;
  document.querySelectorAll('.an-dist-row').forEach(tr =>
    tr.classList.toggle('an-dist-selected', tr.dataset.distid === distId)
  );

  const drilldown = $('an-drilldown');
  drilldown.style.display = 'block';
  $('an-drilldown-inner').innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">Loading…</div>';
  drilldown.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const coFilter   = $('an-co').value;
  const fromFilter = $('an-from').value;
  const toFilter   = $('an-to').value;

  let rows = _analyticsData || [];
  if (coFilter)   rows = rows.filter(c => c.company?.code === coFilter);
  if (fromFilter) rows = rows.filter(c => c.dc_date >= fromFilter);
  if (toFilter)   rows = rows.filter(c => c.dc_date <= toFilter);

  const distChallans = rows.filter(c => (c.distributor?.id || '__none__') === distId);
  const distName     = distChallans[0]?.distributor?.name || '—';
  const challanIds   = distChallans.map(c => c.id);

  if (challanIds.length === 0) {
    $('an-drilldown-inner').innerHTML = '<div class="empty"><div class="empty-title">No challans</div></div>';
    return;
  }

  const itemsAll = [], dcsAll = [];
  for (let i = 0; i < challanIds.length; i += 100) {
    const chunk = challanIds.slice(i, i + 100);
    const [itemsRes, dcsRes] = await Promise.all([
      sb.from('challan_items').select('product_name,bags,qty_qtl,line_value').in('challan_id', chunk),
      sb.from('challans')
        .select('dc_number,challan_type,dc_date,total_bags,total_qty_qtl,total_value,company:companies(code),retailer:retailers(name)')
        .in('id', chunk)
        .order('dc_date', { ascending: false }),
    ]);
    if (itemsRes.data) itemsAll.push(...itemsRes.data);
    if (dcsRes.data)   dcsAll.push(...dcsRes.data);
  }

  const prodMap = new Map();
  for (const it of itemsAll) {
    const name = it.product_name || 'Unknown';
    if (!prodMap.has(name)) prodMap.set(name, { bags: 0, qtl: 0, value: 0 });
    const p = prodMap.get(name);
    p.bags  += Number(it.bags)       || 0;
    p.qtl   += Number(it.qty_qtl)    || 0;
    p.value += Number(it.line_value) || 0;
  }
  const prodSorted = [...prodMap.entries()].sort((a, b) => b[1].bags - a[1].bags);
  dcsAll.sort((a, b) => b.dc_date.localeCompare(a.dc_date));

  $('an-drilldown-inner').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
      <div>
        <div class="section-label" style="margin-bottom:6px">Distributor drill-down</div>
        <div style="font-size:17px;font-weight:700;color:var(--ink)">${distName}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:3px">${challanIds.length} DCs in selected range</div>
      </div>
      <button class="btn btn-sm" onclick="selectDist('${distId}')">Close ✕</button>
    </div>
    <div style="margin-bottom:24px">
      <div class="section-label">Product Breakdown</div>
      <table class="an-table">
        <thead><tr><th>Product</th><th style="text-align:right">Bags</th><th style="text-align:right">Qtl</th><th style="text-align:right">Value (₹)</th></tr></thead>
        <tbody>${prodSorted.map(([name, p]) => `
          <tr>
            <td style="font-weight:500">${name}</td>
            <td style="text-align:right;font-weight:600">${p.bags.toLocaleString('en-IN')}</td>
            <td style="text-align:right">${p.qtl.toFixed(1)}</td>
            <td style="text-align:right">${fmtIN(p.value)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div>
      <div class="section-label">DC History</div>
      <table class="an-table">
        <thead><tr><th>Co.</th><th>DC No.</th><th>Date</th><th>Ship To</th><th style="text-align:right">Bags</th><th style="text-align:right">Qtl</th><th style="text-align:right">Value (₹)</th></tr></thead>
        <tbody>${dcsAll.map(c => `
          <tr>
            <td><span class="reg-co ${c.company?.code === 'ASIAN' ? 'asian' : 'asn'}">${c.company?.code || '—'}</span></td>
            <td class="reg-dcno">${c.company?.code || ''}-${formatDcNumber(c.dc_number, c.challan_type)}</td>
            <td>${fmt(c.dc_date)}</td>
            <td style="color:var(--muted);font-size:12px">${c.retailer?.name || '(direct to dist)'}</td>
            <td style="text-align:right">${(c.total_bags || 0).toLocaleString('en-IN')}</td>
            <td style="text-align:right">${Number(c.total_qty_qtl).toFixed(1)}</td>
            <td style="text-align:right">${fmtIN(c.total_value)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ============================================================
// MASTER DATA TAB
// ============================================================
let activeMasterTab = 'dist';

function showMasterTab(name, btn) {
  activeMasterTab = name;
  document.querySelectorAll('.mtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    const b = document.querySelector(`.mtab-btn[data-mtab="${name}"]`);
    if (b) b.classList.add('active');
  }
  document.querySelectorAll('.mpanel').forEach(p => p.classList.remove('active'));
  $('mpanel-' + name).classList.add('active');
}

function renderMaster() {
  renderDistList();
  renderRetList();
  renderProdList();
  renderLotList();
  renderCoList();
  showMasterTab(activeMasterTab);
}

function renderDistList() {
  const q = ($('dist-search')?.value || '').trim().toLowerCase();
  const items = q
    ? state.distributors.filter(d =>
        (d.name    || '').toLowerCase().includes(q) ||
        (d.city    || '').toLowerCase().includes(q) ||
        (d.manager || '').toLowerCase().includes(q))
    : state.distributors;
  const rows = items.map(d => {
    if (mf.dist.deleteId === d.id) {
      return `<tr style="background:rgba(183,62,62,.04)">
        <td colspan="6" style="font-size:12px;color:var(--red);font-weight:600;padding:12px">
          Delete "${escapeAttr(d.name)}"? This will fail if retailers or challans reference it.
        </td>
        <td style="text-align:right;white-space:nowrap;padding:8px 10px">
          <button class="btn btn-sm" onclick="cancelDeleteDist()">Cancel</button>
          <button class="btn btn-sm btn-danger" style="margin-left:6px" onclick="confirmDeleteDist()">Yes, delete</button>
        </td>
      </tr>`;
    }
    return `<tr>
      <td>${d.name}</td><td>${d.city || '—'}</td><td>${d.manager || '—'}</td>
      <td>${d.phone || '—'}</td><td>${d.gstin || '—'}</td><td>${d.seed_license_no || '—'}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" onclick="showDistForm('${d.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" style="margin-left:4px" onclick="promptDeleteDist('${d.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">No distributors yet</td></tr>';
  $('dist-list').innerHTML = `<table class="reg-table">
    <thead><tr><th>Name</th><th>City</th><th>Manager</th><th>Phone</th><th>GSTIN</th><th>Seed License No.</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderRetList() {
  const q = ($('ret-search')?.value || '').trim().toLowerCase();
  const items = q
    ? state.retailers.filter(r => {
        const dist = state.distributors.find(d => d.id === r.distributor_id);
        return (r.name  || '').toLowerCase().includes(q) ||
               (r.city  || '').toLowerCase().includes(q) ||
               (dist?.name || '').toLowerCase().includes(q);
      })
    : state.retailers;
  const rows = items.map(r => {
    const dist = state.distributors.find(d => d.id === r.distributor_id);
    if (mf.ret.deleteId === r.id) {
      return `<tr style="background:rgba(183,62,62,.04)">
        <td colspan="4" style="font-size:12px;color:var(--red);font-weight:600;padding:12px">
          Delete "${escapeAttr(r.name)}"? This will fail if challans reference it.
        </td>
        <td style="text-align:right;white-space:nowrap;padding:8px 10px">
          <button class="btn btn-sm" onclick="cancelDeleteRet()">Cancel</button>
          <button class="btn btn-sm btn-danger" style="margin-left:6px" onclick="confirmDeleteRet()">Yes, delete</button>
        </td>
      </tr>`;
    }
    return `<tr>
      <td>${r.name}</td><td>${r.city || '—'}</td><td>${r.phone || '—'}</td><td>${dist?.name || '—'}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" onclick="showRetForm('${r.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" style="margin-left:4px" onclick="promptDeleteRet('${r.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">No retailers yet</td></tr>';
  $('ret-list').innerHTML = `<table class="reg-table">
    <thead><tr><th>Name</th><th>City</th><th>Phone</th><th>Distributor</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderProdList() {
  const q = ($('prod-search')?.value || '').trim().toLowerCase();
  const items = q
    ? state.products.filter(p => (p.name || '').toLowerCase().includes(q))
    : state.products;
  const rows = items.map(p => {
    const co = state.companies.find(c => c.id === p.company_id);
    if (mf.prod.deleteId === p.id) {
      return `<tr style="background:rgba(183,62,62,.04)">
        <td colspan="4" style="font-size:12px;color:var(--red);font-weight:600;padding:12px">
          Delete "${escapeAttr(p.name)}"? This will fail if lots or challans reference it.
        </td>
        <td style="text-align:right;white-space:nowrap;padding:8px 10px">
          <button class="btn btn-sm" onclick="cancelDeleteProd()">Cancel</button>
          <button class="btn btn-sm btn-danger" style="margin-left:6px" onclick="confirmDeleteProd()">Yes, delete</button>
        </td>
      </tr>`;
    }
    return `<tr>
      <td><span class="reg-co ${co?.code === 'ASIAN' ? 'asian' : 'asn'}">${co?.code || '—'}</span></td>
      <td>${p.name}</td><td>${p.packing_size_kg} kg</td><td>Rs. ${fmtIN(p.rate_per_bag)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" onclick="showProdForm('${p.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" style="margin-left:4px" onclick="promptDeleteProd('${p.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">No products yet</td></tr>';
  $('prod-list').innerHTML = `<table class="reg-table">
    <thead><tr><th>Co.</th><th>Name</th><th>Pack</th><th>Rate</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderLotList() {
  const q = ($('lot-search')?.value || '').trim().toLowerCase();
  const lotItems = q
    ? state.lots.filter(l => {
        const prod = state.products.find(p => p.id === l.product_id);
        return (l.lot_number  || '').toLowerCase().includes(q) ||
               (prod?.name    || '').toLowerCase().includes(q);
      })
    : state.lots;
  $('lot-list').innerHTML = `<table class="reg-table">
    <thead><tr><th>Co.</th><th>Product</th><th>Lot No.</th><th style="text-align:right">Available</th><th style="text-align:right">Initial</th><th></th></tr></thead>
    <tbody>${lotItems.map(l => {
      const prod = state.products.find(p => p.id === l.product_id);
      const co   = prod ? state.companies.find(c => c.id === prod.company_id) : null;
      const low  = l.bags_available < 50;
      if (mf.lot.deleteId === l.id) {
        return `<tr style="background:rgba(183,62,62,.04)">
          <td colspan="5" style="font-size:12px;color:var(--red);font-weight:600;padding:12px">
            Delete lot "${escapeAttr(l.lot_number)}"? This will fail if challans reference it.
          </td>
          <td style="text-align:right;white-space:nowrap;padding:8px 10px">
            <button class="btn btn-sm" onclick="cancelDeleteLot()">Cancel</button>
            <button class="btn btn-sm btn-danger" style="margin-left:6px" onclick="confirmDeleteLot()">Yes, delete</button>
          </td>
        </tr>`;
      }
      return `<tr>
        <td><span class="reg-co ${co?.code === 'ASIAN' ? 'asian' : 'asn'}">${co?.code || '—'}</span></td>
        <td>${prod?.name || '—'}</td>
        <td style="font-family:'JetBrains Mono',monospace">${l.lot_number}${l.active === false ? ' <span style="color:var(--muted);font-size:10px">(inactive)</span>' : ''}</td>
        <td style="text-align:right${low ? ';color:var(--red);font-weight:600' : ''}">${l.bags_available}</td>
        <td style="text-align:right;color:var(--muted)">${l.initial_bags}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm" onclick="showLotForm('${l.id}')">Edit</button>
          <button class="btn btn-sm btn-danger" style="margin-left:4px" onclick="promptDeleteLot('${l.id}')">Delete</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">No lots yet \u2014 click "+ Add Lot" or import via Excel</td></tr>'}</tbody>
  </table>`;
}

function renderCoList() {
  $('co-list').innerHTML = `<table class="reg-table">
    <thead><tr><th>Code</th><th>Name</th><th>Next DC #</th><th>Next Local (L) #</th><th>GSTIN</th><th></th></tr></thead>
    <tbody>${state.companies.map(c => `<tr>
      <td><span class="reg-co ${c.code === 'ASIAN' ? 'asian' : 'asn'}">${c.code}</span></td>
      <td>${c.name}</td>
      <td class="reg-dcno">${c.next_dc_number}</td>
      <td class="reg-dcno" style="color:var(--gold)">L-${String(c.next_local_dc_number || 1).padStart(2,'0')}</td>
      <td>${c.gstin || '—'}</td>
      <td style="text-align:right"><button class="btn btn-sm" onclick="showCoForm('${c.id}')">Edit</button></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

// ── Master data forms ──────────────────────────────────────────
const mf = {
  dist: { editId: null, deleteId: null },
  ret:  { editId: null, deleteId: null },
  prod: { editId: null, deleteId: null },
  lot:  { editId: null, deleteId: null },
  co:   { editId: null },
};

// ── Distributors ──────────────────────────────────────────────
function showDistForm(id) {
  const d = id ? state.distributors.find(x => x.id === id) : null;
  mf.dist.editId = id || null;
  mf.dist.deleteId = null;
  $('dist-form-wrap').innerHTML = `
    <div class="mf-panel">
      <div class="mf-title">${d ? 'Edit Distributor' : 'New Distributor'}</div>
      <div class="grid grid-3">
        <div class="field"><label>Name *</label>
          <input type="text" id="df-name" value="${escapeAttr(d?.name || '')}" placeholder="Business name"></div>
        <div class="field"><label>City</label>
          <input type="text" id="df-city" value="${escapeAttr(d?.city || '')}" placeholder="e.g. Nanded"></div>
        <div class="field"><label>Manager</label>
          <input type="text" id="df-manager" value="${escapeAttr(d?.manager || '')}" placeholder="Contact person"></div>
        <div class="field"><label>Phone</label>
          <input type="text" id="df-phone" value="${escapeAttr(d?.phone || '')}" placeholder="10-digit number"></div>
        <div class="field"><label>GSTIN</label>
          <input type="text" id="df-gstin" value="${escapeAttr(d?.gstin || '')}" placeholder="27ABCDE1234F1Z5"></div>
        <div class="field"><label>Seed License No.</label>
          <input type="text" id="df-seed-license" value="${escapeAttr(d?.seed_license_no || '')}" placeholder="e.g. SL/MH/2024/001"></div>
        <div class="field"><label>Address</label>
          <input type="text" id="df-address" value="${escapeAttr(d?.address || '')}" placeholder="Street / area"></div>
      </div>
      <div class="mf-actions">
        <button class="btn" onclick="hideDistForm()">Cancel</button>
        <button class="btn btn-primary" onclick="saveDistributor()">${d ? 'Update' : 'Add Distributor'}</button>
      </div>
    </div>
  `;
  const el = $('df-name');
  if (el) el.focus();
}

function hideDistForm() { $('dist-form-wrap').innerHTML = ''; mf.dist.editId = null; }

async function saveDistributor() {
  const name = ($('df-name')?.value || '').trim();
  if (!name) { toast('Name is required', true); return; }
  const payload = {
    name,
    city:            ($('df-city')?.value         || '').trim() || null,
    manager:         ($('df-manager')?.value      || '').trim() || null,
    phone:           ($('df-phone')?.value        || '').trim() || null,
    gstin:           ($('df-gstin')?.value        || '').trim() || null,
    seed_license_no: ($('df-seed-license')?.value || '').trim() || null,
    address:         ($('df-address')?.value      || '').trim() || null,
  };
  const editId = mf.dist.editId;
  if (state.demoMode) {
    if (editId) { const i = state.distributors.findIndex(x => x.id === editId); if (i >= 0) Object.assign(state.distributors[i], payload); }
    else state.distributors.push({ id: 'demo-d-' + Date.now(), ...payload });
    state.distributors.sort((a, b) => a.name.localeCompare(b.name));
    hideDistForm(); renderDistList(); toast('[DEMO] ' + (editId ? 'Distributor updated.' : 'Distributor added.')); return;
  }
  const { error } = editId
    ? await sb.from('distributors').update(payload).eq('id', editId)
    : await sb.from('distributors').insert(payload);
  if (error) { toast(error.message, true); return; }
  hideDistForm();
  await loadAllData();
  renderDistList();
  toast(editId ? 'Distributor updated.' : 'Distributor added.');
}

function promptDeleteDist(id) { mf.dist.deleteId = id; mf.dist.editId = null; hideDistForm(); renderDistList(); }
async function confirmDeleteDist() {
  const id = mf.dist.deleteId;
  if (!id) return;
  if (state.demoMode) { state.distributors = state.distributors.filter(x => x.id !== id); mf.dist.deleteId = null; renderDistList(); toast('[DEMO] Distributor deleted.'); return; }
  const { error } = await sb.from('distributors').delete().eq('id', id);
  if (error) { toast(error.message, true); return; }
  mf.dist.deleteId = null;
  await loadAllData();
  renderDistList();
  toast('Distributor deleted.');
}
function cancelDeleteDist() { mf.dist.deleteId = null; renderDistList(); }

// ── Retailers ─────────────────────────────────────────────────
function showRetForm(id) {
  const r = id ? state.retailers.find(x => x.id === id) : null;
  mf.ret.editId = id || null;
  mf.ret.deleteId = null;
  const distOptions = state.distributors.map(d =>
    `<option value="${d.id}" ${r?.distributor_id === d.id ? 'selected' : ''}>${d.name}${d.city ? ' — ' + d.city : ''}</option>`
  ).join('');
  $('ret-form-wrap').innerHTML = `
    <div class="mf-panel">
      <div class="mf-title">${r ? 'Edit Retailer' : 'New Retailer'}</div>
      <div class="grid grid-3">
        <div class="field"><label>Name *</label>
          <input type="text" id="rf-name" value="${escapeAttr(r?.name || '')}" placeholder="Retailer / shop name"></div>
        <div class="field"><label>City</label>
          <input type="text" id="rf-city" value="${escapeAttr(r?.city || '')}" placeholder="e.g. Hingoli"></div>
        <div class="field"><label>Phone</label>
          <input type="text" id="rf-phone" value="${escapeAttr(r?.phone || '')}" placeholder="Printed on DC"></div>
        <div class="field"><label>Address</label>
          <input type="text" id="rf-address" value="${escapeAttr(r?.address || '')}" placeholder="Street / area"></div>
        <div class="field"><label>GSTIN / TIN</label>
          <input type="text" id="rf-gstin" value="${escapeAttr(r?.gstin || '')}" placeholder="Optional"></div>
        <div class="field"><label>Distributor *</label>
          <select id="rf-dist">
            <option value="">-- pick distributor --</option>
            ${distOptions}
          </select></div>
      </div>
      <div class="mf-actions">
        <button class="btn" onclick="hideRetForm()">Cancel</button>
        <button class="btn btn-primary" onclick="saveRetailer()">${r ? 'Update' : 'Add Retailer'}</button>
      </div>
    </div>
  `;
  const el = $('rf-name');
  if (el) el.focus();
}

function hideRetForm() { $('ret-form-wrap').innerHTML = ''; mf.ret.editId = null; }

async function saveRetailer() {
  const name   = ($('rf-name')?.value  || '').trim();
  const distId = ($('rf-dist')?.value  || '');
  if (!name)   { toast('Name is required',   true); return; }
  if (!distId) { toast('Pick a distributor', true); return; }
  const payload = {
    name,
    city:           ($('rf-city')?.value    || '').trim() || null,
    phone:          ($('rf-phone')?.value   || '').trim() || null,
    address:        ($('rf-address')?.value || '').trim() || null,
    gstin:          ($('rf-gstin')?.value   || '').trim() || null,
    distributor_id: distId,
  };
  const editId = mf.ret.editId;
  if (state.demoMode) {
    if (editId) { const i = state.retailers.findIndex(x => x.id === editId); if (i >= 0) Object.assign(state.retailers[i], payload); }
    else state.retailers.push({ id: 'demo-r-' + Date.now(), ...payload });
    state.retailers.sort((a, b) => a.name.localeCompare(b.name));
    hideRetForm(); renderRetList(); toast('[DEMO] ' + (editId ? 'Retailer updated.' : 'Retailer added.')); return;
  }
  const { error } = editId
    ? await sb.from('retailers').update(payload).eq('id', editId)
    : await sb.from('retailers').insert(payload);
  if (error) { toast(error.message, true); return; }
  hideRetForm();
  await loadAllData();
  renderRetList();
  toast(editId ? 'Retailer updated.' : 'Retailer added.');
}

function promptDeleteRet(id) { mf.ret.deleteId = id; mf.ret.editId = null; hideRetForm(); renderRetList(); }
async function confirmDeleteRet() {
  const id = mf.ret.deleteId;
  if (!id) return;
  if (state.demoMode) { state.retailers = state.retailers.filter(x => x.id !== id); mf.ret.deleteId = null; renderRetList(); toast('[DEMO] Retailer deleted.'); return; }
  const { error } = await sb.from('retailers').delete().eq('id', id);
  if (error) { toast(error.message, true); return; }
  mf.ret.deleteId = null;
  await loadAllData();
  renderRetList();
  toast('Retailer deleted.');
}
function cancelDeleteRet() { mf.ret.deleteId = null; renderRetList(); }

// ── Products ──────────────────────────────────────────────────
function showProdForm(id) {
  const p = id ? state.products.find(x => x.id === id) : null;
  mf.prod.editId = id || null;
  mf.prod.deleteId = null;
  const coOptions = state.companies.map(c =>
    `<option value="${c.id}" ${p?.company_id === c.id ? 'selected' : ''}>${c.name} (${c.code})</option>`
  ).join('');
  $('prod-form-wrap').innerHTML = `
    <div class="mf-panel">
      <div class="mf-title">${p ? 'Edit Product' : 'New Product'}</div>
      <div class="grid grid-2">
        <div class="field"><label>Company *</label>
          <select id="pf-company" ${p ? 'disabled' : ''}>
            <option value="">-- pick company --</option>
            ${coOptions}
          </select>
          ${p ? '<div class="hint" style="font-size:11px;color:var(--muted);margin-top:3px">Company cannot be changed on an existing product</div>' : ''}
        </div>
        <div class="field"><label>Product name *</label>
          <input type="text" id="pf-name" value="${escapeAttr(p?.name || '')}" placeholder="e.g. SOYBEAN SEEDS ASIAN-777 Certified Seeds"></div>
        <div class="field"><label>Packing size (kg) *</label>
          <input type="number" id="pf-pack" value="${p?.packing_size_kg || ''}" step="0.5" min="0.5" placeholder="e.g. 25 or 27"></div>
        <div class="field"><label>Rate per bag (Rs.)</label>
          <input type="number" id="pf-rate" value="${p?.rate_per_bag || ''}" step="1" min="0" placeholder="e.g. 4077"></div>
      </div>
      <div class="mf-actions">
        <button class="btn" onclick="hideProdForm()">Cancel</button>
        <button class="btn btn-primary" onclick="saveProduct()">${p ? 'Update' : 'Add Product'}</button>
      </div>
    </div>
  `;
  const el = $('pf-name');
  if (el) el.focus();
}

function hideProdForm() { $('prod-form-wrap').innerHTML = ''; mf.prod.editId = null; }

async function saveProduct() {
  const name      = ($('pf-name')?.value    || '').trim();
  const companyId = ($('pf-company')?.value || '');
  const pack      = parseFloat($('pf-pack')?.value || '');
  const rate      = parseFloat($('pf-rate')?.value || '') || 0;
  const editId    = mf.prod.editId;
  if (!name)                     { toast('Product name is required', true); return; }
  if (!editId && !companyId)     { toast('Pick a company',            true); return; }
  if (isNaN(pack) || pack <= 0) { toast('Enter a valid packing size', true); return; }
  const payload = { name, packing_size_kg: pack, rate_per_bag: rate };
  if (!editId) payload.company_id = companyId;
  if (state.demoMode) {
    if (editId) { const i = state.products.findIndex(x => x.id === editId); if (i >= 0) Object.assign(state.products[i], payload); }
    else state.products.push({ id: 'demo-p-' + Date.now(), ...payload });
    state.products.sort((a, b) => a.name.localeCompare(b.name));
    hideProdForm(); renderProdList(); toast('[DEMO] ' + (editId ? 'Product updated.' : 'Product added.')); return;
  }
  const { error } = editId
    ? await sb.from('products').update(payload).eq('id', editId)
    : await sb.from('products').insert(payload);
  if (error) { toast(error.message, true); return; }
  hideProdForm();
  await loadAllData();
  renderProdList();
  toast(editId ? 'Product updated.' : 'Product added.');
}

function promptDeleteProd(id) { mf.prod.deleteId = id; mf.prod.editId = null; hideProdForm(); renderProdList(); }
async function confirmDeleteProd() {
  const id = mf.prod.deleteId;
  if (!id) return;
  if (state.demoMode) { state.products = state.products.filter(x => x.id !== id); mf.prod.deleteId = null; renderProdList(); toast('[DEMO] Product deleted.'); return; }
  const { error } = await sb.from('products').delete().eq('id', id);
  if (error) { toast(error.message, true); return; }
  mf.prod.deleteId = null;
  await loadAllData();
  renderProdList();
  toast('Product deleted.');
}
function cancelDeleteProd() { mf.prod.deleteId = null; renderProdList(); }

// ── Lots ──────────────────────────────────────────────────────
function showLotForm(id) {
  const l = id ? state.lots.find(x => x.id === id) : null;
  mf.lot.editId = id || null;
  mf.lot.deleteId = null;
  const prodOptions = state.products.map(p => {
    const co = state.companies.find(c => c.id === p.company_id);
    return `<option value="${p.id}" ${l?.product_id === p.id ? 'selected' : ''}>[${co?.code || '?'}] ${p.name}</option>`;
  }).join('');
  $('lot-form-wrap').innerHTML = `
    <div class="mf-panel">
      <div class="mf-title">${l ? 'Edit Lot' : 'New Lot'}</div>
      <div class="grid grid-3">
        <div class="field" style="grid-column:1/3"><label>Product *</label>
          <select id="lf-product" ${l ? 'disabled' : ''}>
            <option value="">-- pick product --</option>
            ${prodOptions}
          </select>
          ${l ? '<div class="hint" style="font-size:11px;color:var(--muted);margin-top:3px">Product cannot be changed on an existing lot</div>' : ''}
        </div>
        <div class="field"><label>Lot number *</label>
          <input type="text" id="lf-lotno" value="${escapeAttr(l?.lot_number || '')}" placeholder="e.g. OCT25-12-IND-123" style="font-family:monospace"></div>
        <div class="field"><label>${l ? 'Available bags' : 'Bags in lot *'}</label>
          <input type="number" id="lf-bags" value="${l ? l.bags_available : ''}" step="1" min="0" placeholder="e.g. 500"></div>
        ${l ? `<div class="field"><label>Status</label>
          <select id="lf-active">
            <option value="true"  ${l.active !== false ? 'selected' : ''}>Active (shows in dropdowns)</option>
            <option value="false" ${l.active === false  ? 'selected' : ''}>Inactive (hidden)</option>
          </select></div>` : ''}
      </div>
      <div class="mf-actions">
        <button class="btn" onclick="hideLotForm()">Cancel</button>
        <button class="btn btn-primary" onclick="saveLot()">${l ? 'Update' : 'Add Lot'}</button>
      </div>
    </div>
  `;
  const el = l ? $('lf-bags') : $('lf-lotno');
  if (el) el.focus();
}

function hideLotForm() { $('lot-form-wrap').innerHTML = ''; mf.lot.editId = null; }

async function saveLot() {
  const productId = ($('lf-product')?.value || '');
  const lotNo     = ($('lf-lotno')?.value   || '').trim();
  const bags      = parseInt($('lf-bags')?.value || '', 10);
  const editId    = mf.lot.editId;
  if (!editId && !productId)      { toast('Pick a product',          true); return; }
  if (!lotNo)                     { toast('Lot number is required',  true); return; }
  if (isNaN(bags) || bags < 0)   { toast('Enter a valid bag count', true); return; }
  let payload;
  if (editId) {
    payload = { lot_number: lotNo, bags_available: bags };
    const activeEl = $('lf-active');
    if (activeEl) payload.active = activeEl.value === 'true';
  } else {
    payload = { product_id: productId, lot_number: lotNo, bags_available: bags, initial_bags: bags };
  }
  if (state.demoMode) {
    if (editId) { const i = state.lots.findIndex(x => x.id === editId); if (i >= 0) Object.assign(state.lots[i], payload); }
    else state.lots.push({ id: 'demo-l-' + Date.now(), ...payload });
    hideLotForm(); updateCompanyMeta(); renderLotList(); toast('[DEMO] ' + (editId ? 'Lot updated.' : `Lot ${lotNo} added (${bags} bags).`)); return;
  }
  const { error } = editId
    ? await sb.from('product_lots').update(payload).eq('id', editId)
    : await sb.from('product_lots').insert(payload);
  if (error) { toast(error.message, true); return; }
  hideLotForm();
  await loadAllData();
  renderLotList();
  toast(editId ? 'Lot updated.' : `Lot ${lotNo} added (${bags} bags).`);
}

function promptDeleteLot(id) { mf.lot.deleteId = id; mf.lot.editId = null; hideLotForm(); renderLotList(); }
async function confirmDeleteLot() {
  const id = mf.lot.deleteId;
  if (!id) return;
  if (state.demoMode) { state.lots = state.lots.filter(x => x.id !== id); mf.lot.deleteId = null; updateCompanyMeta(); renderLotList(); toast('[DEMO] Lot deleted.'); return; }
  const { error } = await sb.from('product_lots').delete().eq('id', id);
  if (error) { toast(error.message, true); return; }
  mf.lot.deleteId = null;
  await loadAllData();
  renderLotList();
  toast('Lot deleted.');
}
function cancelDeleteLot() { mf.lot.deleteId = null; renderLotList(); }

// ── Companies ─────────────────────────────────────────────────
function showCoForm(id) {
  const c = id ? state.companies.find(x => x.id === id) : null;
  if (!c) return;
  mf.co.editId = id;
  $('co-form-wrap').innerHTML = `
    <div class="mf-panel">
      <div class="mf-title">Edit: ${escapeAttr(c.name)}</div>
      <div class="grid grid-2">
        <div class="field"><label>Company name</label>
          <input type="text" id="cf-name" value="${escapeAttr(c.name || '')}"></div>
        <div class="field"><label>GSTIN</label>
          <input type="text" id="cf-gstin" value="${escapeAttr(c.gstin || '')}"></div>
        <div class="field"><label>CIN</label>
          <input type="text" id="cf-cin" value="${escapeAttr(c.cin || '')}"></div>
        <div class="field"><label>Phone</label>
          <input type="text" id="cf-phone" value="${escapeAttr(c.phone || '')}"></div>
        <div class="field"><label>Email</label>
          <input type="text" id="cf-email" value="${escapeAttr(c.email || '')}"></div>
        <div class="field"><label>Seed Lic. No.</label>
          <input type="text" id="cf-lic1" value="${escapeAttr(c.lic1 || '')}"></div>
        <div class="field"><label>Seed Lic. No. 2 (optional)</label>
          <input type="text" id="cf-lic2" value="${escapeAttr(c.lic2 || '')}"></div>
        <div class="field"><label>Next Regular DC number</label>
          <input type="number" id="cf-nextdc" value="${c.next_dc_number || 1}" min="1" step="1"></div>
        <div class="field"><label>Next Local (L-series) DC number</label>
          <input type="number" id="cf-nextlocal" value="${c.next_local_dc_number || 1}" min="1" step="1"></div>
        <div class="field" style="grid-column:1/-1"><label>Office address</label>
          <input type="text" id="cf-offaddr" value="${escapeAttr(c.office_addr || '')}"></div>
        <div class="field" style="grid-column:1/-1"><label>Plant address</label>
          <input type="text" id="cf-plantaddr" value="${escapeAttr(c.plant_addr || '')}"></div>
        <div class="field" style="grid-column:1/-1"><label>Logo URL</label>
          <input type="text" id="cf-logo" value="${escapeAttr(c.logo_url || '')}" placeholder="Paste a base64 data URL or image URL"></div>
      </div>
      <div class="mf-actions">
        <button class="btn" onclick="hideCoForm()">Cancel</button>
        <button class="btn btn-primary" onclick="saveCompany()">Update</button>
      </div>
    </div>
  `;
}

function hideCoForm() { $('co-form-wrap').innerHTML = ''; mf.co.editId = null; }

async function saveCompany() {
  const id = mf.co.editId;
  if (!id) return;
  const payload = {
    name:        ($('cf-name')?.value      || '').trim() || undefined,
    gstin:       ($('cf-gstin')?.value     || '').trim() || null,
    cin:         ($('cf-cin')?.value       || '').trim() || null,
    phone:       ($('cf-phone')?.value     || '').trim() || null,
    email:       ($('cf-email')?.value     || '').trim() || null,
    lic1:        ($('cf-lic1')?.value      || '').trim() || null,
    lic2:        ($('cf-lic2')?.value      || '').trim() || null,
    office_addr: ($('cf-offaddr')?.value   || '').trim() || null,
    plant_addr:  ($('cf-plantaddr')?.value || '').trim() || null,
    logo_url:    ($('cf-logo')?.value      || '').trim() || null,
  };
  const nextDc = parseInt($('cf-nextdc')?.value, 10);
  if (!isNaN(nextDc) && nextDc > 0) payload.next_dc_number = nextDc;
  const nextLocal = parseInt($('cf-nextlocal')?.value, 10);
  if (!isNaN(nextLocal) && nextLocal > 0) payload.next_local_dc_number = nextLocal;
  const { error } = await sb.from('companies').update(payload).eq('id', id);
  if (error) { toast(error.message, true); return; }
  hideCoForm();
  await loadAllData();
  renderCoList();
  toast('Company settings updated.');
}

// ============================================================
// EXCEL TEMPLATES + BULK IMPORT
// ============================================================
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
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

function downloadTemplate(kind) {
  const schema = IMPORT_SCHEMAS[kind];
  if (!schema) return;
  const aoa = [schema.columns];
  const samples = {
    distributors: ['(sample) Santosh Beej Bhandar', 'Nanded', 'Rakesh Kumar', '27ABCDE1234F1Z5', 'MH/2024/1234', '9876543210', 'Main Road, Nanded'],
    retailers:    ['(sample) Pandurang KSK', 'Himayatnagar', '9876543210', 'Santosh Beej Bhandar', '', '', ''],
    lots:         ['(sample) SOYBEAN SEEDS ASIAN-777 Certified Seeds', 'OCT25-12-IND-123', 500, '2025-10-15', '2026-10-15', 'first batch'],
  };
  aoa.push(samples[kind]);
  aoa.push(['(delete this and the sample row before importing)']);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = schema.columns.map(c => ({ wch: Math.max(14, c.length + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, kind);
  XLSX.writeFile(wb, `${kind}_template.xlsx`);
  toast(`Template downloaded: ${kind}_template.xlsx`);
}

async function importExcel(kind, inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  inputEl.value = '';
  const schema = IMPORT_SCHEMAS[kind];
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
    if (rows.length === 0) { toast('Sheet is empty', true); return; }
    const cleanRows = rows.filter(r => {
      const firstVal = r[schema.columns[0]];
      if (!firstVal) return false;
      const s = String(firstVal).toLowerCase();
      if (s.includes('(sample)') || s.includes('(example)') || s.includes('delete this')) return false;
      return true;
    });
    if (cleanRows.length === 0) { toast('No valid rows found (did you delete the sample rows?)', true); return; }
    if (!confirm(`Import ${cleanRows.length} ${schema.label} from "${file.name}"?\n\nThis will ADD them — existing entries are kept.`)) return;

    const inserts = [], errors = [];
    for (let i = 0; i < cleanRows.length; i++) {
      const r = cleanRows[i];
      const rowNum = i + 2;
      const missing = schema.required.filter(f => !r[f] && r[f] !== 0);
      if (missing.length) { errors.push(`Row ${rowNum}: missing ${missing.join(', ')}`); continue; }
      try { inserts.push(schema.mapRow(r)); }
      catch (e) { errors.push(`Row ${rowNum}: ${e.message}`); }
    }
    if (errors.length && inserts.length === 0) {
      alert('Import failed:\n\n' + errors.slice(0, 10).join('\n') + (errors.length > 10 ? `\n…and ${errors.length - 10} more` : ''));
      return;
    }
    if (errors.length) {
      const ok = confirm(`${errors.length} row(s) had problems and will be SKIPPED:\n\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? '\n…\n' : ''}\n\nContinue with ${inserts.length} good row(s)?`);
      if (!ok) return;
    }
    const CHUNK = 100;
    let inserted = 0;
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const chunk = inserts.slice(i, i + CHUNK);
      const { error } = await sb.from(schema.table).insert(chunk);
      if (error) { toast(`Import stopped after ${inserted}: ${error.message}`, true); break; }
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
// DEMO MODE
// ============================================================
function enterDemo() {
  state.demoMode = true;
  state.demoChallans = [];
  state.demoDcCounters = {};
  state.demoLocalDcCounters = {};
  DEMO_DATA.companies.forEach(c => {
    state.demoDcCounters[c.id] = 1;
    state.demoLocalDcCounters[c.id] = 1;
  });
  state.user = { email: 'demo@example.com', id: 'demo-user' };
  state.lots = [];
  $('demo-banner').style.display = 'block';
  $('login-screen').style.display = 'none';
  enterApp();
}

async function saveChallanDemo() {
  const errs = validateBatch();
  if (errs.length) { toast(errs[0], true); return; }

  const btn = $('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const challansToSave = buildChallansData();
    if (!challansToSave.length) { toast('No items with a product selected', true); return; }

    const isLocal = state.challanType === 'local';
    const savedChallans = [];

    for (const d of challansToSave) {
      let dcNum;
      if (isLocal) {
        dcNum = state.demoLocalDcCounters[d.company.id] || 1;
        state.demoLocalDcCounters[d.company.id] = dcNum + 1;
      } else {
        dcNum = state.demoDcCounters[d.company.id] || 1;
        state.demoDcCounters[d.company.id] = dcNum + 1;
      }

      if (!d.handwrite) {
        for (const it of d.items)
          for (const lot of it.lots) {
            const sl = state.lots.find(l => l.id === lot.lot_id);
            if (sl) sl.bags_available = Math.max(0, sl.bags_available - Number(lot.bags));
          }
      }

      const challan = {
        id:             'demo-ch-' + Math.random().toString(36).slice(2),
        dc_number:      dcNum,
        challan_type:   d.challan_type,
        dc_date:        d.dc_date,
        company:        d.company,
        distributor:    d.distributor,
        retailer:       d.retailer,
        farmer_name:    d.farmer_name || null,
        farmer_village: d.farmer_village || null,
        farmer_phone:   d.farmer_phone || null,
        lorry_no:       d.lorry_no,
        transport:      d.transport,
        freight_status: d.freight_status,
        total_bags:     d.total_bags,
        total_qty_qtl:  d.total_qty_qtl,
        total_value:    d.total_value,
        bill_no:        null,
        lr_no:          null,
        handwrite:      d.handwrite,
        items:          d.items,
      };
      state.demoChallans.unshift(challan);
      savedChallans.push({ ...d, dc_number: dcNum });
    }

    updateCompanyMeta();
    showChallanPreview(savedChallans);
    const labels = savedChallans.map(d => `${d.company.code}-${formatDcNumber(d.dc_number, d.challan_type)}`).join(' + ');
    toast(`[DEMO] ${labels} saved!`);

    state.parties = [makeParty()];
    renderParties();
    updateTotals();
  } catch (e) {
    toast('Demo save error: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate All DCs';
  }
}

function renderRegisterDemo() {
  const wrap = $('reg-table-wrap');
  const coFilter   = $('reg-co-filter').value;
  const search     = $('reg-search').value.trim().toLowerCase();
  const typeFilter = $('reg-type-filter')?.value || '';

  let challans = state.demoChallans;
  if (coFilter)   challans = challans.filter(c => c.company?.code === coFilter);
  if (typeFilter) challans = challans.filter(c => c.challan_type === typeFilter);
  if (search)     challans = challans.filter(c => {
    const hay = [c.dc_number, c.distributor?.name, c.retailer?.name, c.farmer_name, c.lorry_no]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(search);
  });

  state.challans = challans;

  if (challans.length === 0) {
    wrap.innerHTML = '<div class="empty"><div class="empty-title">No demo challans yet</div>Create one in the New Batch tab.</div>';
    return;
  }

  wrap.innerHTML = `<table class="reg-table">
    <thead>
      <tr>
        <th>Co.</th><th>DC No.</th><th>Type</th><th>Date</th>
        <th>Bill To / Farmer</th><th>Ship To / Village</th>
        <th style="text-align:right">Bags</th><th style="text-align:right">Qtl</th>
        <th style="text-align:right">Value (₹)</th><th></th>
      </tr>
    </thead>
    <tbody>
      ${challans.map(c => {
        const isLocal = c.challan_type === 'local';
        const dcDisplay = formatDcNumber(c.dc_number, c.challan_type);
        return `<tr>
          <td><span class="reg-co ${c.company?.code === 'ASIAN' ? 'asian' : 'asn'}">${c.company?.code || '—'}</span></td>
          <td class="reg-dcno">${c.company?.code || ''}-${dcDisplay}</td>
          <td><span style="font-size:10px;padding:2px 7px;border-radius:100px;background:${isLocal ? 'rgba(176,133,69,.15)' : 'rgba(45,107,60,.1)'};color:${isLocal ? '#6a4d20' : 'var(--green-deep)'};font-weight:600">${isLocal ? '🌾 Local' : 'Regular'}</span></td>
          <td>${fmt(c.dc_date)}</td>
          <td>${isLocal ? (c.farmer_name || '—') : (c.distributor?.name || '—')}</td>
          <td>${isLocal ? (c.farmer_village || '—') : (c.retailer?.name || '—')}</td>
          <td style="text-align:right">${c.total_bags}</td>
          <td style="text-align:right">${Number(c.total_qty_qtl).toFixed(2)}</td>
          <td style="text-align:right">${fmtIN(c.total_value)}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm" onclick="reprintChallan('${c.id}')">View</button>
            <button class="btn btn-sm btn-danger" onclick="promptDeleteChallan('${c.id}')" style="margin-left:4px">Delete</button>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

// ============================================================
// D2D TRANSFERS
// ============================================================
const xferState = {
  fromDistId: '', fromDistName: '',
  toDistId:   '', toDistName:   '',
  items: [],
};

let _xferInited = false;

function initTransferTab() {
  if (!_xferInited) {
    $('xf-date').value = fmt(new Date());
    setupCombo({
      inputId:  'xf-from-input',
      hiddenId: 'xf-from-hidden',
      listId:   'xf-from-list',
      source:   () => state.distributors,
      onPick:   (id, name) => { xferState.fromDistId = id; xferState.fromDistName = name; },
    });
    setupCombo({
      inputId:  'xf-to-input',
      hiddenId: 'xf-to-hidden',
      listId:   'xf-to-list',
      source:   () => state.distributors,
      onPick:   (id, name) => { xferState.toDistId = id; xferState.toDistName = name; },
    });
    if (xferState.items.length === 0) addXferItem();
    _xferInited = true;
  }
  renderXferItems();
  loadTransferLog();
}

function addXferItem() {
  xferState.items.push({ id: Math.random().toString(36).slice(2), product_id: '', lot_id: '', bags: '' });
  renderXferItems();
}

function delXferItem(itemId) {
  if (xferState.items.length <= 1) { toast('At least one item required', true); return; }
  xferState.items = xferState.items.filter(i => i.id !== itemId);
  renderXferItems();
}

function onXferProductPick(itemId, productId) {
  const it = xferState.items.find(i => i.id === itemId);
  if (!it) return;
  it.product_id = productId;
  it.lot_id = '';
  it.bags = '';
  renderXferItems();
}

function onXferLotPick(itemId, lotId) {
  const it = xferState.items.find(i => i.id === itemId);
  if (it) it.lot_id = lotId;
}

function onXferBagsChange(itemId, value) {
  const it = xferState.items.find(i => i.id === itemId);
  if (it) it.bags = value;
}

function renderXferItems() {
  const tbody = $('xfer-items-tbody');
  if (!tbody) return;

  if (xferState.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--muted);font-size:12px">No items yet — click &ldquo;+ Add Item&rdquo;.</td></tr>`;
    return;
  }

  tbody.innerHTML = xferState.items.map((it, idx) => {
    const productOptions = '<option value="">— pick product —</option>' +
      state.companies.map(co => {
        const coProds = state.products.filter(p => p.company_id === co.id && p.active !== false);
        if (!coProds.length) return '';
        return `<optgroup label="${co.code}">${
          coProds.map(p => `<option value="${p.id}" ${it.product_id === p.id ? 'selected' : ''}>${p.name}</option>`).join('')
        }</optgroup>`;
      }).join('');

    const productLots = it.product_id
      ? state.lots.filter(l => l.product_id === it.product_id && l.active !== false)
      : [];
    const lotOptions = '<option value="">— pick lot —</option>' +
      productLots.map(l =>
        `<option value="${l.id}" ${it.lot_id === l.id ? 'selected' : ''}>${l.lot_number} (${l.bags_available} avail)</option>`
      ).join('');

    return `<tr>
      <td style="text-align:center;color:var(--ink);font-size:13px;font-weight:600">${idx + 1}</td>
      <td><select onchange="onXferProductPick('${it.id}', this.value)">${productOptions}</select></td>
      <td><select onchange="onXferLotPick('${it.id}', this.value)" ${!it.product_id ? 'disabled' : ''}>${lotOptions}</select></td>
      <td><input type="number" step="1" min="1" value="${escapeAttr(String(it.bags))}"
        oninput="onXferBagsChange('${it.id}', this.value)" style="width:100%"></td>
      <td><button class="btn btn-sm btn-icon" onclick="delXferItem('${it.id}')" title="Remove">&times;</button></td>
    </tr>`;
  }).join('');
}

function clearXfer() {
  xferState.fromDistId = ''; xferState.fromDistName = '';
  xferState.toDistId   = ''; xferState.toDistName   = '';
  xferState.items = [];
  const fi = $('xf-from-input'); if (fi) { fi.value = ''; fi.classList.remove('has-selection'); }
  const fh = $('xf-from-hidden'); if (fh) fh.value = '';
  const ti = $('xf-to-input');   if (ti) { ti.value = ''; ti.classList.remove('has-selection'); }
  const th = $('xf-to-hidden');   if (th) th.value = '';
  const n  = $('xf-notes');       if (n)  n.value  = '';
  $('xf-date').value = fmt(new Date());
  addXferItem();
}

async function saveTransfer() {
  const fromId = ($('xf-from-hidden')?.value || '').trim();
  const toId   = ($('xf-to-hidden')?.value   || '').trim();
  if (!fromId)         { toast('Select a "From" distributor', true); return; }
  if (!toId)           { toast('Select a "To" distributor', true); return; }
  if (fromId === toId) { toast('From and To must be different distributors', true); return; }

  const errs = [];
  for (const [i, it] of xferState.items.entries()) {
    if (!it.product_id)          errs.push(`Item ${i + 1}: pick a product`);
    if (!it.lot_id)              errs.push(`Item ${i + 1}: pick a lot`);
    if (!(Number(it.bags) > 0)) errs.push(`Item ${i + 1}: bags must be > 0`);
  }
  if (errs.length) { toast(errs[0], true); return; }

  if (state.demoMode) { toast('[DEMO] Transfer recorded (not saved to database)'); clearXfer(); return; }

  const btn = $('xfer-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const { data: xfer, error: xErr } = await sb.from('transfers').insert({
      transfer_date: $('xf-date').value,
      from_dist_id:  fromId,
      to_dist_id:    toId,
      notes:         ($('xf-notes')?.value || '').trim() || null,
      created_by:    state.user.id,
    }).select().single();
    if (xErr) throw xErr;

    const itemRows = xferState.items.map((it, idx) => {
      const product = state.products.find(p => p.id === it.product_id);
      const lot     = state.lots.find(l => l.id === it.lot_id);
      return {
        transfer_id:  xfer.id,
        position:     idx + 1,
        product_id:   it.product_id,
        product_name: product?.name || '',
        lot_id:       it.lot_id,
        lot_number:   lot?.lot_number || '',
        bags:         Number(it.bags),
      };
    });
    const { error: iErr } = await sb.from('transfer_items').insert(itemRows);
    if (iErr) throw iErr;
    toast('Transfer saved!');
    clearXfer();
    loadTransferLog();
  } catch (e) {
    toast('Save failed: ' + (e.message || e), true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Transfer';
  }
}

async function loadTransferLog() {
  const wrap = $('xfer-log-wrap');
  if (!wrap) return;
  if (state.demoMode) {
    wrap.innerHTML = '<div class="empty"><div class="empty-title">No transfers in demo mode</div>Sign in and save a real transfer to see the log.</div>';
    return;
  }
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  const { data, error } = await sb.from('transfers').select(`
    id, transfer_date, notes, created_at,
    from_dist:distributors!from_dist_id(id, name, city),
    to_dist:distributors!to_dist_id(id, name, city),
    items:transfer_items(id, product_name, lot_number, bags, position)
  `).order('transfer_date', { ascending: false })
    .order('created_at',    { ascending: false })
    .limit(300);

  if (error) {
    wrap.innerHTML = `<div class="empty"><div class="empty-title">Failed to load</div>${error.message}</div>`;
    return;
  }
  if (!data || data.length === 0) {
    wrap.innerHTML = '<div class="empty"><div class="empty-title">No transfers yet</div>Record one above.</div>';
    return;
  }
  wrap.innerHTML = `<table class="reg-table">
    <thead><tr><th>Date</th><th>From</th><th>To</th><th>Products</th><th style="text-align:right">Bags</th><th>Notes</th><th></th></tr></thead>
    <tbody>${data.map(t => {
      const sorted = (t.items || []).slice().sort((a, b) => a.position - b.position);
      const totalBags   = sorted.reduce((s, i) => s + i.bags, 0);
      const itemSummary = sorted.map(i => {
        const shortName = (i.product_name || '').split(' ').slice(0, 3).join(' ');
        return `${shortName} (${i.lot_number}) × ${i.bags}`;
      }).join(', ');
      return `<tr>
        <td>${fmt(t.transfer_date)}</td>
        <td>${t.from_dist?.name || '—'} <span style="color:var(--muted);font-size:11px">${t.from_dist?.city || ''}</span></td>
        <td>${t.to_dist?.name   || '—'} <span style="color:var(--muted);font-size:11px">${t.to_dist?.city   || ''}</span></td>
        <td style="font-size:12px;color:var(--ink-soft);max-width:280px">${itemSummary}</td>
        <td style="text-align:right;font-weight:600">${totalBags}</td>
        <td style="font-size:12px;color:var(--muted)">${t.notes || ''}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm btn-danger" onclick="promptDeleteTransfer('${t.id}')">Delete</button>
        </td>
      </tr>`;
    }).join('')}
    </tbody>
  </table>`;
}

async function promptDeleteTransfer(id) {
  if (!confirm('Delete this transfer record? This cannot be undone.')) return;
  const { error } = await sb.from('transfers').delete().eq('id', id);
  if (error) { toast('Delete failed: ' + error.message, true); return; }
  toast('Transfer deleted.');
  loadTransferLog();
}

// ============================================================
// BOOT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
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
