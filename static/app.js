const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user = null, mode = 'login', pending = null, timer, RATES = {EGP: {rate: 1, symbol: 'ج.م'}}, offers = [];
let cur = localStorage.getItem('cur') || 'EGP';
const S = {tab: 'flights', view: 'flights', data: {}, err: {}, params: {}, sort: 'price', sel: new Set()};
const AIR = {'مصر للطيران': ['#0b3d91', 'م'], 'نايل إير': ['#0e7c66', 'ن'], 'إير كايرو': ['#d97706', 'ك']};
const BTN = 'w-full bg-accent hover:bg-accent-dark text-white font-extrabold rounded-xl py-3 px-8 transition';
const CARD = 'relative bg-white rounded-2xl border border-slate-200 p-5 mb-4 grid md:grid-cols-[1fr_auto] gap-5 items-center hover:shadow-xl transition';
const PRICE = (t, sub) => `<div class="md:border-s md:border-dashed md:border-slate-200 md:ps-6 md:text-end">
  <div class="text-3xl font-extrabold text-accent">${fmt(t)}</div><div class="text-xs text-slate-500">${sub}</div>`;

// الأسعار بتتحوّل حسب العملة المختارة (الأسعار الأساسية من السيرفر بالجنيه)
const fmt = n => { const c = RATES[cur] || RATES.EGP; return Math.round(n * c.rate).toLocaleString('ar-EG') + ' ' + c.symbol; };
const dur = m => `${m / 60 | 0} س ${m % 60} د`;
const arrive = (t, m) => { const x = (+t.slice(0, 2) * 60 + +t.slice(3) + m) % 1440; return String(x / 60 | 0).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
const addDays = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

async function api(url, method = 'GET', body) {
  const r = await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: body && JSON.stringify(body)});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || 'حصل خطأ، جرّب تاني'); e.status = r.status; throw e; }
  return d;
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.replace('opacity-0', 'opacity-100'); setTimeout(() => el.classList.replace('opacity-100', 'opacity-0'), 2800); }

// ---- التنقل ----
$$('#nav button').forEach(b => b.onclick = () => setView(b.dataset.view));
$$('.wtab').forEach(b => b.onclick = () => setView(b.dataset.tab));
function mark(v) { $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === v)); }
function setView(v) {
  const was = S.view, bk = v === 'bookings';
  mark(v);
  $('#bSection').hidden = !bk; $('#offers').hidden = bk; $('#widget').hidden = bk;
  if (bk) { S.view = v; $('#searchView').hidden = true; $('#note').hidden = true; return loadBookings(); }
  if (v === 'offers') {  // لو كنت في حجوزاتي، ارجع للرئيسية الأول وبعدين انزل للعروض
    if (was === 'bookings') { S.view = S.tab; renderSearch(true); }
    return requestAnimationFrame(() => $('#offers').scrollIntoView({behavior: 'smooth'}));
  }
  S.view = S.tab = v; S.sort = 'price'; S.sel = new Set();
  $$('.wtab').forEach(b => b.classList.toggle('on', b.dataset.tab === v));
  $('#fForm').hidden = v !== 'flights'; $('#hForm').hidden = v !== 'hotels';
  renderSearch(); window.scrollTo({top: 0, behavior: 'smooth'});
}

// ---- البحث (بيتحدّث تلقائي مع أي تغيير) ----
function params(kind) {
  const d = Object.fromEntries(new FormData($(kind === 'flights' ? '#fForm' : '#hForm')));
  if (d.trip !== 'round') delete d.return_date;
  delete d.trip;
  if (!d.return_date) delete d.return_date;
  return d;
}
function skeleton() {
  $('#searchView').hidden = false; $('#note').hidden = true; $('#filters').innerHTML = '';
  $('#list').innerHTML = [1, 2, 3].map(() => `<div class="animate-pulse motion-reduce:animate-none bg-white rounded-2xl border border-slate-200 p-5 mb-4 h-32" aria-busy="true">
    <div class="h-4 bg-slate-200 rounded w-1/3 mb-4"></div><div class="h-6 bg-slate-200 rounded w-2/3 mb-3"></div><div class="h-4 bg-slate-200 rounded w-1/2"></div></div>`).join('');
}
async function search(kind, showLoad) {
  S.params[kind] = params(kind);
  if (showLoad && S.tab === kind) { skeleton(); await new Promise(r => setTimeout(r, 450)); }
  try { S.data[kind] = await api(`/api/${kind}?` + new URLSearchParams(S.params[kind])); S.err[kind] = null; }
  catch (e) { S.err[kind] = e.message; }
  if (S.tab === kind) renderSearch(true);
}
[['fForm', 'flights'], ['hForm', 'hotels']].forEach(([id, kind]) => {
  $('#' + id).onsubmit = e => { e.preventDefault(); search(kind, true); };
  $('#' + id).addEventListener('change', e => {
    if (e.target.name === 'trip') $('#fForm [name=return_date]').disabled = e.target.value !== 'round';
    if (S.data[kind] || S.err[kind]) { clearTimeout(timer); timer = setTimeout(() => search(kind), 250); }
  });
});

function renderSearch(keep) {
  const k = S.tab, rows = S.data[k];
  $('#searchView').hidden = !(rows || S.err[k]); $('#note').hidden = !rows;
  if (S.err[k]) { $('#filters').innerHTML = ''; $('#list').innerHTML = `<p class="text-center text-red-600 py-10">${esc(S.err[k])}</p>`; return; }
  if (!rows) return;
  if (!keep || !$('#filters').innerHTML) $('#filters').innerHTML = filtersHtml(rows);
  renderList();
}
function filtersHtml(rows) {
  const f = S.tab === 'flights', opt = 'flex items-center gap-2 py-1 cursor-pointer';
  const sorts = f ? [['price', 'الأرخص'], ['time', 'الأبكر'], ['duration', 'الأسرع']] : [['price', 'الأرخص'], ['rating', 'الأعلى تقييماً'], ['stars', 'الأعلى نجوماً']];
  const keys = f ? [...new Set(rows.map(r => r.airline))] : [...new Set(rows.map(r => r.stars))].sort().reverse();
  return '<h4 class="font-bold mb-2">رتّب حسب</h4>' + sorts.map(([v, l]) => `<label class="${opt}"><input type="radio" name="sort" value="${v}" class="accent-[#1B75BC]" ${S.sort === v ? 'checked' : ''}>${l}</label>`).join('')
    + `<h4 class="font-bold mt-5 mb-2">${f ? 'شركة الطيران' : 'عدد النجوم'}</h4>` + keys.map(v => `<label class="${opt}"><input type="checkbox" name="f" value="${esc(v)}" class="accent-[#1B75BC]" ${S.sel.has(String(v)) ? 'checked' : ''}>${f ? esc(v) : v + ' نجوم'}</label>`).join('');
}
$('#filters').addEventListener('change', () => {
  S.sort = ($('#filters input[name=sort]:checked') || {}).value || 'price';
  S.sel = new Set([...$$('#filters input[name=f]:checked')].map(i => i.value));
  renderList();
});
const SORTS = {price: (a, b) => a.total - b.total, time: (a, b) => a.depart_time.localeCompare(b.depart_time),
  duration: (a, b) => a.duration_min - b.duration_min, rating: (a, b) => b.rating - a.rating, stars: (a, b) => b.stars - a.stars};

function renderList() {
  const k = S.tab, f = k === 'flights', p = S.params[k];
  const rows = S.data[k].filter(r => !S.sel.size || S.sel.has(String(r[f ? 'airline' : 'stars']))).sort(SORTS[S.sort]);
  const min = Math.min(...rows.map(r => r.total));
  const badge = r => r.total === min ? '<span class="absolute -top-3 start-5 bg-accent text-white text-xs font-bold px-3 py-1 rounded-full">الأرخص</span>' : '';
  $('#list').innerHTML = `<p class="text-slate-500 mb-3">${rows.length} نتيجة</p>` + (rows.map(r => {
    if (f) { const [c, l] = AIR[r.airline] || ['#1B75BC', '✈'];
      return `<article class="${CARD}">${badge(r)}
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 shrink-0 rounded-2xl grid place-items-center text-white text-xl font-extrabold" style="background:${c}">${l}</div>
          <div class="flex-1"><div class="font-bold">${esc(r.airline)}</div>
            <div class="flex items-center gap-3 my-1"><b class="text-2xl">${r.depart_time}</b>
              <div class="flex-1 text-center text-xs text-slate-500">${dur(r.duration_min)}<div class="h-0.5 bg-slate-200 my-1"></div>${r.stops ? 'توقف واحد' : 'مباشرة'}</div>
              <b class="text-2xl">${arrive(r.depart_time, r.duration_min)}</b></div>
            <div class="text-sm text-slate-500">${esc(r.origin_name)} إلى ${esc(r.dest_name)}${r.round_trip ? ' - ذهاب وعودة' : ''}${p.cabin === 'business' ? ' - رجال أعمال' : ''}</div></div></div>
        ${PRICE(r.total, `${fmt(r.price)} للراكب (${p.passengers})`)}<button class="${BTN} mt-3" data-id="${r.id}">احجز الآن</button></div></article>`; }
    return `<article class="${CARD}">${badge(r)}
      <div class="flex gap-4 items-center">
        <div class="relative w-32 h-28 shrink-0 rounded-2xl overflow-hidden bg-gradient-to-br from-sky-300 to-brand grid place-items-center text-4xl">🏨
          <img src="/img/hotels/${r.id}.jpg" data-city="${r.city}" alt="${esc(r.name)}" loading="lazy" onerror="imgFb(this)" class="absolute inset-0 w-full h-full object-cover" style="object-position:${['left', 'center', 'right'][r.stars % 3]}"></div>
        <div><div class="font-bold text-lg">${esc(r.name)}</div><div class="text-amber-500" aria-label="${r.stars} نجوم">${'★'.repeat(r.stars)}</div>
          <div class="text-sm text-slate-500 mt-1"><span class="bg-brand text-white font-bold rounded-lg px-2 me-1">${r.rating}</span>${esc(r.city_name)} - ${r.nights} ليلة - ${p.rooms} غرفة</div></div></div>
      ${PRICE(r.total, `متوسط ${fmt(r.price_per_night)} في الليلة`)}<button class="${BTN} mt-3" data-id="${r.id}">احجز الآن</button></div></article>`;
  }).join('') || '<p class="text-center text-slate-500 py-10">مفيش نتائج بالفلاتر دي.</p>');
  $$('#list button').forEach(b => b.onclick = () => book(f
    ? {type: 'flight', item_id: +b.dataset.id, date: p.date, return_date: p.return_date, cabin: p.cabin, qty: +p.passengers}
    : {type: 'hotel', item_id: +b.dataset.id, date: p.checkin, end_date: p.checkout, qty: +p.rooms}));
}

// ---- صور المدن (حقيقية من ويكيبيديا) ----
const WIKI = {CAI: 'Cairo', HRG: 'Hurghada', SSH: 'Sharm_El_Sheikh', LXR: 'Luxor', ASW: 'Aswan', DXB: 'Dubai', JED: 'Jeddah', RUH: 'Riyadh', IST: 'Istanbul'};
let PHOTO = JSON.parse(localStorage.getItem('photos') || '{}');
async function loadPhotos() {
  await Promise.all(Object.entries(WIKI).filter(([c]) => !PHOTO[c]).map(async ([c, t]) => {
    try {
      const d = await (await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + t)).json();
      if (d.originalimage && d.originalimage.width <= 1400) PHOTO[c] = d.originalimage.source;
      else if (d.thumbnail) PHOTO[c] = d.thumbnail.source.replace(/\/\d+px-/, '/960px-');
    } catch (e) { /* بنكمّل من غير صورة */ }
  }));
  localStorage.setItem('photos', JSON.stringify(PHOTO));
  renderOffers(); if (S.data[S.tab] && S.view !== 'bookings') renderList();
}
// صورة الفندق: /img/hotels/<id>.jpg لو موجودة، وإلا صورة المدينة، وإلا الخلفية الملونة
function imgFb(el) { const u = PHOTO[el.dataset.city]; if (u && el.src !== u) el.src = u; else el.remove(); }

// ---- العروض ----
function renderOffers() {
  $('#offerGrid').innerHTML = offers.map((o, i) => `<button data-i="${i}" class="group relative overflow-hidden h-52 text-start rounded-3xl text-white bg-gradient-to-bl from-brand-dark to-brand hover:shadow-xl transition">
    ${PHOTO[o.dest] ? `<img src="${PHOTO[o.dest]}" alt="${esc(o.dest_name)}" loading="lazy" onerror="this.remove()" class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-500 motion-reduce:transition-none">` : ''}
    <div class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent"></div>
    <div class="relative h-full p-6 flex flex-col justify-end">
      <div class="text-sm opacity-90">${esc(o.origin_name)} إلى</div><div class="text-2xl font-extrabold">${esc(o.dest_name)}</div>
      <div class="mt-2 text-sm opacity-90">يبدأ من <b class="text-lg">${fmt(o.price)}</b></div></div></button>`).join('');
  $$('#offerGrid button').forEach(b => b.onclick = () => {
    const o = offers[b.dataset.i], f = $('#fForm');
    f.from.value = o.origin; f.to.value = o.dest; f.date.value = o.date; f.return_date.value = addDays(28);
    setView('flights'); search('flights', true); window.scrollTo({top: 0, behavior: 'smooth'});
  });
}

// ---- العملة ----
$('#cur').onchange = e => {
  cur = e.target.value; localStorage.setItem('cur', cur);
  renderOffers(); if (S.view !== 'bookings' && S.data[S.tab]) renderList();
  if (!$('#bSection').hidden) loadBookings();
};

// ---- الحجز ----
async function book(payload) {
  try { const r = await api('/api/bookings', 'POST', payload); toast('تم الحجز. الإجمالي ' + fmt(r.total)); setView('bookings'); }
  catch (er) { if (er.status === 401) openAuth(() => book(payload)); else toast(er.message); }
}
async function loadBookings() {
  const box = $('#bList');
  if (!user) { box.innerHTML = '<p class="text-center text-slate-500 py-10">سجّل دخولك علشان تشوف حجوزاتك.</p>'; return openAuth(loadBookings); }
  const rows = await api('/api/bookings');
  box.innerHTML = rows.map(b => `<article class="${CARD}"><div><div class="font-bold text-lg">${esc(b.title)}</div>
    <div class="text-sm text-slate-500">${b.type === 'flight' ? 'طيران' : 'فندق'} - ${b.start_date}${b.end_date ? ' إلى ' + b.end_date : ''} - الكمية ${b.qty}</div></div>
    <div class="md:text-end"><div class="text-2xl font-extrabold text-accent">${fmt(b.total)}</div>
    <span class="inline-block text-xs font-bold rounded-full px-3 py-1 ${b.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}">${b.status === 'confirmed' ? 'مؤكد' : 'ملغي'}</span>
    ${b.status === 'confirmed' ? `<button class="block text-brand font-semibold mt-2" data-id="${b.id}">إلغاء الحجز</button>` : ''}</div></article>`).join('')
    || '<p class="text-center text-slate-500 py-10">لسه معندكش حجوزات. ابدأ بالبحث عن رحلة.</p>';
  $$('#bList button').forEach(b => b.onclick = async () => { await api('/api/bookings/' + b.dataset.id, 'DELETE'); toast('تم إلغاء الحجز'); loadBookings(); });
}

// ---- الحساب ----
function renderAuth() {
  $('#auth').innerHTML = user
    ? `<span class="font-semibold">أهلاً ${esc(user.name)}</span> <button class="text-brand font-semibold ms-2" id="out">خروج</button>`
    : '<button id="in" class="bg-brand hover:bg-brand-dark text-white font-bold rounded-full px-5 py-2">دخول</button>';
  if (user) $('#out').onclick = async () => { await api('/api/logout', 'POST'); user = null; renderAuth(); setView('flights'); };
  else $('#in').onclick = () => openAuth();
}
function openAuth(after) { pending = after || null; setMode('login'); $('#authErr').textContent = ''; $('#authDlg').showModal(); }
function setMode(m) {
  mode = m; const reg = m === 'register';
  $('#authTitle').textContent = reg ? 'إنشاء حساب' : 'تسجيل الدخول';
  $('#authBtn').textContent = reg ? 'أنشئ الحساب' : 'دخول';
  $('#authSwitch').textContent = reg ? 'عندي حساب، أدخل' : 'معنديش حساب، أسجّل جديد';
  $('#nameRow').hidden = !reg;
}
$('#authSwitch').onclick = () => setMode(mode === 'login' ? 'register' : 'login');
$('#authClose').onclick = () => $('#authDlg').close();
$('#authDlg').addEventListener('close', () => { if (S.view === 'bookings' && !user) setView(S.tab); });
$('#authForm').onsubmit = async e => {
  e.preventDefault();
  try {
    user = await api(mode === 'login' ? '/api/login' : '/api/register', 'POST', Object.fromEntries(new FormData(e.target)));
    $('#authDlg').close(); renderAuth(); toast('تم تسجيل الدخول');
    if (pending) { const p = pending; pending = null; p(); }
  } catch (er) { $('#authErr').textContent = er.message; }
};

// ---- تشغيل ----
(async () => {
  $$('input[type=date]').forEach(i => i.min = addDays(0));
  $('[name=date]').value = addDays(10); $('[name=return_date]').value = addDays(17);
  $('[name=checkin]').value = addDays(10); $('[name=checkout]').value = addDays(13);
  const cities = (await api('/api/cities')).map(c => `<option value="${c.code}">${esc(c.name)}</option>`).join('');
  $$('#fForm select[name=from],#fForm select[name=to],#hForm select').forEach(s => s.innerHTML = cities);
  $('#fForm [name=to]').selectedIndex = 1;
  RATES = await api('/api/rates'); $('#cur').value = RATES[cur] ? cur : 'EGP'; cur = $('#cur').value;
  offers = await api('/api/offers'); renderOffers(); loadPhotos();
  user = await api('/api/me'); renderAuth();
})();
