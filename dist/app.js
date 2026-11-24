'use strict';

const byId = id => document.getElementById(id);
const config = window.BAQAT_CONFIG;
const configured = Boolean(config?.supabaseUrl && config?.publishableKey);
const dateTime = new Intl.DateTimeFormat('ar-SA', {
  timeZone: 'Asia/Riyadh', calendar: 'gregory', dateStyle: 'medium', timeStyle: 'short',
});
const money = halalas => new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 }).format(halalas / 100) + ' ريال';
const mealLabels = { lunch: 'غداء', dinner: 'عشاء', both: 'غداء وعشاء' };
const selected = new Map();
const vouchers = new Map();
let session;
let merchant;
let searchSequence = 0;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(label, onClick) {
  const control = node('button', label);
  control.type = 'button';
  control.addEventListener('click', onClick);
  return control;
}

function status(text) {
  const target = byId('status');
  target.textContent = text;
  target.hidden = !text;
  if (text) target.scrollIntoView({ block: 'nearest' });
}

function riyadhDate() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts();
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

async function api(path, options = {}) {
  if (!configured) throw new Error('UNCONFIGURED');
  const headers = { apikey: config.publishableKey, 'Content-Type': 'application/json' };
  if (options.signedIn) {
    if (!session?.access_token) throw new Error('AUTH_REQUIRED');
    headers.Authorization = 'Bearer ' + session.access_token;
  }
  const response = await fetch(config.supabaseUrl.replace(/\/$/, '') + path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401 && options.signedIn) {
      clearSession();
      throw new Error('AUTH_REQUIRED');
    }
    throw new Error(result?.message || result?.error_code || 'REQUEST_FAILED');
  }
  return result;
}

function explain(error) {
  return {
    UNCONFIGURED: 'اتصال قاعدة بيانات باقات غير مهيأ.',
    AUTH_REQUIRED: 'سجّل الدخول للمتابعة.',
    OFFER_UNAVAILABLE: 'الباقة غير متاحة لإصدار رمز الآن.',
    ISSUE_LIMIT: 'وصلت إلى حد إصدار الرموز. حاول لاحقًا.',
    ACTIVE_CODE_EXISTS: 'لديك رمز ساري لهذه الباقة. استخدمه أو انتظر انتهاء صلاحيته.',
  }[error.message] || 'تعذّر إكمال العملية. تحقق من المدخلات وحاول مرة أخرى.';
}

function submit(id, handler) {
  const form = byId(id);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const controls = [...form.querySelectorAll('button')].filter(control => !control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try {
      status('');
      await handler(values, event.submitter, form);
    } catch (error) {
      status(explain(error));
    } finally {
      controls.forEach(control => { control.disabled = false; });
    }
  });
}

function clearSession() {
  session = undefined;
  merchant = undefined;
  vouchers.clear();
  byId('details').close();
  byId('details-body').replaceChildren();
  renderAccount();
}

function renderAccount() {
  byId('auth').hidden = Boolean(session);
  byId('logout').hidden = !session;
  byId('merchant-application').hidden = !session || Boolean(merchant);
  byId('merchant').hidden = !merchant?.approved;
  byId('merchant-status').textContent = merchant
    ? merchant.approved ? 'حساب التاجر معتمد.' : 'طلب حساب التاجر بانتظار المراجعة.'
    : '';
  if (!merchant?.approved) byId('merchant-offers').replaceChildren();
}

async function fetchMerchant() {
  const actor = session.user.id;
  const [profile] = await api('/rest/v1/baqat_merchants?select=name,approved&user_id=eq.' + actor, { signedIn: true });
  if (session?.user.id !== actor) return;
  merchant = profile;
  renderAccount();
  if (merchant?.approved) await fetchMerchantOffers();
}

async function fetchMerchantOffers() {
  const actor = session.user.id;
  const offers = await api('/rest/v1/baqat_offers?order=starts_at.desc&merchant_id=eq.' + actor, { signedIn: true });
  if (session?.user.id !== actor) return;
  byId('merchant-offers').replaceChildren(...offers.map(offer => {
    const card = node('article', undefined, 'card');
    const control = button(offer.published ? 'أوقف النشر' : 'انشر الباقة', async () => {
      control.disabled = true;
      try {
        await api('/rest/v1/baqat_offers?id=eq.' + offer.id, {
          signedIn: true, method: 'PATCH', body: { published: !offer.published },
        });
        await Promise.all([fetchMerchantOffers(), searchOffers()]);
      } catch (error) {
        status(explain(error));
      } finally {
        control.disabled = false;
      }
    });
    card.append(node('h3', offer.name), node('p', offer.published ? 'منشورة' : 'مسودة'), control);
    return card;
  }));
}

async function searchOffers() {
  const version = ++searchSequence;
  const values = Object.fromEntries(new FormData(byId('search')));
  const start = new Date(values.day + 'T00:00:00+03:00').getTime();
  if (!Number.isFinite(start)) return;
  const query = new URLSearchParams({
    order: 'price_halalas.asc,id.asc',
    limit: '100',
    published: 'eq.true',
    starts_at: 'lt.' + new Date(start + 86400000).toISOString(),
    ends_at: 'gt.' + new Date(Math.max(start, Date.now())).toISOString(),
    price_halalas: 'lte.' + Math.round(Number(values.budget) * 100),
    people: 'gte.' + values.people,
  });
  if (values.meal !== 'both') query.set('meal', 'in.(' + values.meal + ',both)');
  if (values.area === 'north') query.set('north', 'eq.true');
  byId('result-count').textContent = 'جاري البحث…';
  try {
    const offers = await api('/rest/v1/baqat_offers?' + query);
    if (version !== searchSequence) return;
    for (const id of selected.keys()) {
      const current = offers.find(offer => offer.id === id);
      if (current) selected.set(id, current);
      else selected.delete(id);
    }
    renderComparison();
    byId('results').replaceChildren(...offers.map(offerCard));
    byId('result-count').textContent = offers.length
      ? (offers.length === 100 ? 'أول ١٠٠ باقة بالسعر' : offers.length + ' باقات مطابقة')
      : 'ما لقينا باقات مطابقة. جرّب تغيير التاريخ أو توسيع نطاق البحث.';
  } catch (error) {
    if (version !== searchSequence) return;
    byId('result-count').textContent = explain(error);
    byId('results').replaceChildren();
    selected.clear();
    renderComparison();
  }
}

function offerCard(offer) {
  const card = node('article', undefined, 'card');
  const compare = button(selected.has(offer.id) ? 'إلغاء الاختيار' : 'قارن', () => {
    if (selected.has(offer.id)) selected.delete(offer.id);
    else if (selected.size < 3) selected.set(offer.id, offer);
    else return status('تقدر تقارن ثلاث باقات في المرة الواحدة.');
    compare.textContent = selected.has(offer.id) ? 'إلغاء الاختيار' : 'قارن';
    compare.setAttribute('aria-pressed', String(selected.has(offer.id)));
    renderComparison();
  });
  compare.setAttribute('aria-pressed', String(selected.has(offer.id)));
  const actions = node('div', undefined, 'actions');
  actions.append(button('التفاصيل والموقع', () => showDetails(offer)), compare);
  card.append(node('h3', offer.name), node('p', offer.venue + ' · ' + offer.district),
    node('p', money(offer.price_halalas), 'price'), node('p', 'حتى ' + offer.people + ' أشخاص · ' + mealLabels[offer.meal]), actions);
  return card;
}

function renderComparison() {
  byId('compare-button').disabled = selected.size < 2;
  byId('compare-button').textContent = selected.size ? 'قارن المختار (' + selected.size + ')' : 'قارن المختار';
  byId('comparison').hidden = true;
}

function showDetails(offer) {
  const panel = byId('details-body');
  panel.replaceChildren(node('h2', offer.name), node('p', offer.inclusions), node('p', offer.address),
    node('p', dateTime.format(new Date(offer.starts_at)) + ' إلى ' + dateTime.format(new Date(offer.ends_at))));
  const lat = Number(offer.latitude);
  const lon = Number(offer.longitude);
  const map = new URL('https://www.openstreetmap.org/export/embed.html');
  map.searchParams.set('bbox', [lon - .008, lat - .006, lon + .008, lat + .006].join(','));
  map.searchParams.set('marker', lat + ',' + lon);
  const frame = node('iframe');
  frame.src = map.href;
  frame.title = 'خريطة موقع ' + offer.venue;
  frame.loading = 'lazy';
  const directions = node('a', 'فتح الاتجاهات');
  directions.href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(lat + ',' + lon);
  directions.target = '_blank';
  directions.rel = 'noopener noreferrer';
  const issueStatus = node('p');
  issueStatus.setAttribute('role', 'status');
  function showVoucher(voucher) {
    const code = node('code', voucher.code);
    code.dir = 'ltr';
    issueStatus.textContent = 'ينتهي الرمز في ' + dateTime.format(new Date(voucher.expires_at));
    panel.append(code);
    issue.disabled = true;
  }
  const issue = button('اطلب رمز الباقة', async () => {
    if (!session) {
      byId('details').close();
      byId('account').hidden = false;
      return status('سجّل الدخول ثم افتح الباقة لطلب الرمز.');
    }
    const actor = session.user.id;
    issue.disabled = true;
    try {
      const [voucher] = await api('/rest/v1/rpc/baqat_issue', {
        signedIn: true, method: 'POST', body: { offer: offer.id },
      });
      if (session?.user.id !== actor) return;
      vouchers.set(offer.id, voucher);
      if (panel.contains(issue)) showVoucher(voucher);
    } catch (error) {
      issueStatus.textContent = explain(error);
      issue.disabled = false;
    }
  });
  const links = node('div', undefined, 'actions');
  links.append(directions, issue);
  panel.append(frame, links, issueStatus);
  const existing = vouchers.get(offer.id);
  if (existing && Date.parse(existing.expires_at) > Date.now()) showVoucher(existing);
  byId('details').showModal();
}

byId('account-nav').addEventListener('click', () => {
  byId('account').hidden = !byId('account').hidden;
  if (!byId('account').hidden) byId('account-title').scrollIntoView({ block: 'nearest' });
});
byId('logout').addEventListener('click', async () => {
  try {
    await api('/auth/v1/logout', { method: 'POST', signedIn: true });
  } catch (error) {
    status(explain(error));
  } finally {
    clearSession();
  }
});
byId('compare-button').addEventListener('click', () => {
  const table = node('table');
  const heading = table.createTHead().insertRow();
  heading.append(node('th', 'المعيار'), ...[...selected.values()].map(offer => node('th', offer.name)));
  const body = table.createTBody();
  const fields = [
    ['السعر النهائي', offer => money(offer.price_halalas)],
    ['الأشخاص', offer => offer.people],
    ['المكونات', offer => offer.inclusions],
    ['الحي', offer => offer.district],
    ['التوفر', offer => dateTime.format(new Date(offer.starts_at)) + ' إلى ' + dateTime.format(new Date(offer.ends_at))],
  ];
  for (const [label, value] of fields) {
    body.insertRow().append(node('th', label), ...[...selected.values()].map(offer => node('td', value(offer))));
  }
  byId('comparison').replaceChildren(table);
  byId('comparison').hidden = false;
  byId('comparison').scrollIntoView({ block: 'nearest' });
});
submit('auth', async ({ email, password }, action, form) => {
  const signup = action?.value === 'signup';
  const route = signup
    ? '/auth/v1/signup?redirect_to=' + encodeURIComponent(location.origin + location.pathname)
    : '/auth/v1/token?grant_type=password';
  const result = await api(route, { method: 'POST', body: { email, password } });
  form.reset();
  if (!result.access_token) return status('تحقق من بريدك لتأكيد الحساب، ثم سجّل الدخول.');
  session = result;
  renderAccount();
  await fetchMerchant();
});
submit('merchant-application', async ({ name }) => {
  await api('/rest/v1/baqat_merchants', {
    signedIn: true, method: 'POST', body: { user_id: session.user.id, name: name.trim() },
  });
  await fetchMerchant();
});
submit('offer-form', async (values, _, form) => {
  const startsAt = values.starts_at + '+03:00';
  const endsAt = values.ends_at + '+03:00';
  if (new Date(startsAt) >= new Date(endsAt)) return status('اختر نهاية توفر بعد البداية.');
  await api('/rest/v1/baqat_offers', {
    signedIn: true, method: 'POST',
    body: {
      merchant_id: session.user.id, name: values.name.trim(), venue: values.venue.trim(),
      district: values.district.trim(), address: values.address.trim(),
      latitude: Number(values.latitude), longitude: Number(values.longitude),
      price_halalas: Math.round(Number(values.price) * 100), people: Number(values.people),
      north: values.north === 'on', meal: values.meal, inclusions: values.inclusions.trim(),
      starts_at: startsAt, ends_at: endsAt,
    },
  });
  form.reset();
  await fetchMerchantOffers();
  status('تم حفظ المسودة.');
});
submit('redeem', async ({ code }, _, form) => {
  code = code.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(code)) {
    return status('أدخل رمز الباقة الكامل.');
  }
  const [result] = await api('/rest/v1/rpc/baqat_redeem', { signedIn: true, method: 'POST', body: { code } });
  if (!result) return status('تعذّر استخدام الرمز. قد يكون منتهيًا أو مُستخدمًا أو لباقـة أخرى.');
  form.reset();
  status('تم استخدام رمز «' + result.offer_name + '».');
});
submit('search', searchOffers);
byId('search').elements.day.value = riyadhDate();
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
searchOffers();
