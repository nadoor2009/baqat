import { createSession } from './session.mjs';
'use strict';

const byId = id => document.getElementById(id);
let firebaseConfig;
const dateTime = new Intl.DateTimeFormat('ar-SA', {
  timeZone: 'Asia/Riyadh', calendar: 'gregory', dateStyle: 'medium', timeStyle: 'short',
});
const money = halalas => new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 }).format(halalas / 100) + ' ريال';
const mealLabels = { lunch: 'غداء', dinner: 'عشاء', both: 'غداء وعشاء' };
const selected = new Map();
const vouchers = new Map();
let session;
let editingOffer;
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
  const requestSession = session;
  const headers = { 'Content-Type': 'application/json' };
  if (options.signedIn) {
    const current = session;
    if (!current) throw new Error('AUTH_REQUIRED');
    try {
      headers.Authorization = 'Bearer ' + await current.accessToken();
    } catch (error) {
      if (error.message === 'AUTH_REQUIRED' && session === current) clearSession();
      throw error;
    }
    if (session !== current) throw new Error('AUTH_REQUIRED');
  }
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401 && options.signedIn) {
      if (session === requestSession) clearSession();
      throw new Error('AUTH_REQUIRED');
    }
    throw new Error(result?.message || result?.error_code || 'REQUEST_FAILED');
  }
  return result;
}

function explain(error) {
  return {
    AUTH_UNCONFIGURED: 'خدمة تسجيل الحسابات لم تُربط بعد.',
    AUTH_UNAVAILABLE: 'تعذّر تسجيل الدخول أو إرسال رسالة التأكيد. تحقق من البريد وكلمة المرور وحاول مجددًا.',
    INVALID_LOGIN_CREDENTIALS: 'تأكد من البريد الإلكتروني وكلمة المرور.',
    EMAIL_NOT_FOUND: 'تأكد من البريد الإلكتروني وكلمة المرور.',
    INVALID_PASSWORD: 'تأكد من البريد الإلكتروني وكلمة المرور.',
    EMAIL_EXISTS: 'هذا البريد مسجل بالفعل. جرّب تسجيل الدخول.',
    EMAIL_UNVERIFIED: 'أكد بريدك أولًا. يمكنك إعادة إرسال رابط التأكيد.',
    ACTIVE_VOUCHERS: 'ما تقدر تعدّل الباقة وفيها رموز سارية. جرّب بعد استخدامها أو انتهاء صلاحيتها.',
    ISSUE_DENIED: 'تعذّر إصدار الرمز. تحقق من توفر الباقة ومن عدم وجود رمز ساري لها. الحد عشرة رموز في الساعة.',
    MERCHANT_REQUIRED: 'تحتاج حساب تاجر معتمد لإضافة باقة.',
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
  session?.close();
  session = undefined;
  resetOfferForm();
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
  const [profile] = await api('/api/merchant', { signedIn: true });
  if (session?.user.id !== actor) return;
  merchant = profile;
  renderAccount();
  if (merchant?.approved) await fetchMerchantOffers();
}

function resetOfferForm() {
  editingOffer = undefined;
  byId('offer-form').reset();
  byId('offer-form-title').textContent = 'إضافة باقة';
  byId('save-offer').textContent = 'حفظ مسودة';
  byId('cancel-edit').hidden = true;
}

function editOffer(offer) {
  const controls = byId('offer-form').elements;
  const localTime = value => new Date(Date.parse(value) + 3 * 3600000).toISOString().slice(0, 16);
  for (const key of ['name', 'venue', 'district', 'address', 'latitude', 'longitude', 'people', 'meal', 'inclusions']) {
    controls.namedItem(key).value = offer[key];
  }
  controls.namedItem('price').value = offer.price_halalas / 100;
  controls.namedItem('north').checked = Boolean(offer.north);
  controls.namedItem('starts_at').value = localTime(offer.starts_at);
  controls.namedItem('ends_at').value = localTime(offer.ends_at);
  editingOffer = offer.id;
  byId('offer-form-title').textContent = 'تعديل الباقة';
  byId('save-offer').textContent = 'حفظ التعديلات';
  byId('cancel-edit').hidden = false;
  controls.namedItem('name').focus();
}

async function fetchMerchantOffers() {
  const actor = session.user.id;
  const offers = await api('/api/merchant/offers', { signedIn: true });
  if (session?.user.id !== actor) return;
  byId('merchant-offers').replaceChildren(...offers.map(offer => {
    const card = node('article', undefined, 'card');
    const control = button(offer.published ? 'أوقف النشر' : 'انشر الباقة', async () => {
      control.disabled = true;
      try {
        await api('/api/merchant/offers/' + offer.id, {
          signedIn: true, method: 'PATCH', body: { published: !offer.published },
        });
        await Promise.all([fetchMerchantOffers(), searchOffers()]);
      } catch (error) {
        status(explain(error));
      } finally {
        control.disabled = false;
      }
    });
    card.append(node('h3', offer.name), node('p', offer.published ? 'منشورة' : 'مسودة'),
      control, button('عدّل الباقة', () => editOffer(offer)));
    return card;
  }));
}

async function searchOffers() {
  const version = ++searchSequence;
  const values = Object.fromEntries(new FormData(byId('search')));
  const start = new Date(values.day + 'T00:00:00+03:00').getTime();
  if (!Number.isFinite(start)) return;
  const query = new URLSearchParams({
    day: values.day, people: values.people, meal: values.meal, area: values.area,
    budget: Math.round(Number(values.budget) * 100),
  });
  byId('result-count').textContent = 'جاري البحث…';
  try {
    const offers = await api('/api/offers?' + query);
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
      const [voucher] = await api('/api/vouchers', {
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
byId('logout').addEventListener('click', () => {
  clearSession();
  status('تم تسجيل الخروج من هذه الصفحة.');
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
async function firebase(action, payload) {
  if (!firebaseConfig) firebaseConfig = await api('/api/config');
  if (!firebaseConfig.apiKey) throw new Error('AUTH_UNCONFIGURED');
  const endpoint = 'https://identitytoolkit.googleapis.com/v1/accounts:' + action +
    '?key=' + encodeURIComponent(firebaseConfig.apiKey);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'AUTH_UNAVAILABLE');
  return data;
}

submit('auth', async ({ email, password }, action, form) => {
  const signup = action?.value === 'signup';
  const result = await firebase(signup ? 'signUp' : 'signInWithPassword', {
    email, password, returnSecureToken: true,
  });
  form.reset();
  if (signup || action?.value === 'verify') {
    await firebase('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: result.idToken });
    return status('أرسلنا رابط تأكيد البريد. افتح الرابط ثم سجّل الدخول.');
  }
  session = createSession(result, firebaseConfig.apiKey);
  try {
    await fetchMerchant();
  } catch (error) {
    clearSession();
    throw error;
  }
  status('تم تسجيل الدخول.');
});
submit('merchant-application', async ({ name }) => {
  await api('/api/merchant', {
    signedIn: true, method: 'POST', body: { name: name.trim() },
  });
  await fetchMerchant();
});
byId('cancel-edit').addEventListener('click', resetOfferForm);
submit('offer-form', async values => {
  const id = editingOffer;
  const startsAt = values.starts_at + '+03:00';
  const endsAt = values.ends_at + '+03:00';
  if (new Date(startsAt) >= new Date(endsAt)) return status('اختر نهاية توفر بعد البداية.');
  await api('/api/merchant/offers' + (id ? '/' + id : ''), {
    signedIn: true, method: id ? 'PUT' : 'POST',
    body: {
      name: values.name.trim(), venue: values.venue.trim(),
      district: values.district.trim(), address: values.address.trim(),
      latitude: Number(values.latitude), longitude: Number(values.longitude),
      price_halalas: Math.round(Number(values.price) * 100), people: Number(values.people),
      north: values.north === 'on', meal: values.meal, inclusions: values.inclusions.trim(),
      starts_at: startsAt, ends_at: endsAt,
    },
  });
  if (editingOffer === id) resetOfferForm();
  await Promise.all([fetchMerchantOffers(), searchOffers()]);
  status(id ? 'تم حفظ تعديلات الباقة.' : 'تم حفظ المسودة.');
});
submit('redeem', async ({ code }, _, form) => {
  code = code.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(code)) {
    return status('أدخل رمز الباقة الكامل.');
  }
  const [result] = await api('/api/vouchers/redeem', { signedIn: true, method: 'POST', body: { code } });
  if (!result) return status('تعذّر استخدام الرمز. قد يكون منتهيًا أو مُستخدمًا أو لباقـة أخرى.');
  form.reset();
  status('تم استخدام رمز «' + result.offer_name + '».');
});
submit('search', searchOffers);
byId('search').elements.day.value = riyadhDate();
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
searchOffers();
