import { BrandMark, colors, Icon } from './ui';
import { OfferDate, OfferLocation } from './OfferPickers';
import VoucherScanner, { voucherCode } from './VoucherScanner';
import * as SecureStore from 'expo-secure-store';
import { phoneAuth, requestPhoneCode, confirmPhoneCode, nativeSession } from './phone';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Marker } from 'react-native-maps';
import QRCode from 'react-native-qrcode-svg';
import { CategoryGrid, Photo, categories, sampleOffers } from './discovery';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet,
  StatusBar, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, authenticate, errorMessage, riyadhDay, riyadhTime } from './api';

const meals = [['both', 'الغداء والعشاء'], ['lunch', 'الغداء'], ['dinner', 'العشاء']];
const categoriesWithAll = [['all', 'كل الأنشطة'], ...categories];
const cityOptions = ['الرياض', 'جدة', 'مكة المكرمة', 'المدينة المنورة', 'الدمام', 'أبها', 'تبوك', 'بريدة',
  'حائل', 'عرعر', 'سكاكا', 'جازان', 'نجران', 'الباحة'].map(city => [city, city]);
const money = amount => new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 }).format(amount / 100) + ' ريال';
const normalize = value => value.trim().replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)).replace(/٫/g, '.');

function Button({ label, onPress, secondary = false, disabled = false, selected, icon, filled, accessibilityLabel }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label}
    accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary,
      pressed && styles.pressed, disabled && styles.disabled]}>
    {icon && <Icon name={icon} color={secondary ? colors.primary : colors.onPrimary} size={18} filled={filled} />}
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}

function Input({ label, value, onChangeText, ltr, ...props }) {
  const [focused, setFocused] = useState(false);
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={[styles.input, ltr && styles.ltr, focused && styles.inputFocused]}
      placeholderTextColor={colors.muted} {...props} />
  </View>;
}

function Choices({ options, value, change }) {
  return <View style={styles.row}>{options.map(([id, label]) =>
    <Button key={id} label={label} selected={value === id} secondary={value !== id} onPress={() => change(id)} />)}</View>;
}

function Picker({ label, options, value, change, custom = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const select = id => { change(id); setOpen(false); setQuery(''); };
  const selected = options.find(([id]) => id === value)?.[1] || value || 'اختر المدينة';
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <Button label={selected} secondary onPress={() => setOpen(!open)} />
    {open && <>
      {custom && <Input label="ابحث عن مدينة" value={query} onChangeText={setQuery} maxLength={80} />}
      <Choices options={options.filter(([, name]) => name.includes(query.trim()))} value={value} change={select} />
      {custom && query.trim().length >= 2 && !options.some(([id]) => id === query.trim()) &&
        <Button label={'اختر ' + query.trim()} onPress={() => select(query.trim())} />}
    </>}
  </View>;
}

function Card({ children, style }) { return <View style={[styles.card, style]}>{children}</View>; }
function Title({ children }) { return <Text accessibilityRole="header" style={styles.title}>{children}</Text>; }
function Copy({ children }) { return <Text style={styles.copy}>{children}</Text>; }

function OfferCard({ offer, onOpen, selected, onCompare, saved, onSave }) {
  return <Card style={styles.listing}>
    <Pressable onPress={onOpen} accessibilityRole="button"
      accessibilityLabel={offer.name + '، ' + money(offer.price_halalas)}
      accessibilityHint={offer.venue + '، ' + offer.district + (offer.sample ? '، عرض تجريبي' : '')}
      style={({ pressed }) => [styles.listingLink, pressed && styles.pressed]}>
      <Photo uri={offer.image_url} meal={offer.meal} category={offer.category} style={styles.listingPhoto} />
      <View style={styles.listingDetails}>
        {offer.sample && <Text style={styles.sample}>عرض تجريبي</Text>}
        <Title>{offer.name}</Title>
        <Copy>{offer.venue} · {offer.city || 'الرياض'} · {offer.district}</Copy>
        <View style={styles.listingMeta}>
          <Text style={styles.price}>{money(offer.price_halalas)}</Text>
          <Copy>حتى {offer.people} أشخاص</Copy>
        </View>
      </View>
    </Pressable>
    <View style={styles.listingActions}>
      <Button label="التفاصيل" onPress={onOpen} />
      <Button label={saved ? 'محفوظة' : 'حفظ'} icon="heart" filled={saved}
        selected={saved} secondary onPress={onSave} />
      <Button label={selected ? 'إلغاء المقارنة' : 'قارن'} selected={selected} onPress={onCompare} secondary />
    </View>
  </Card>;
}

const offerFields = [
  ['name', 'اسم الباقة'], ['venue', 'اسم الفرع (اختياري)'],
  ['price', 'السعر النهائي بالريال', 'decimal-pad'], ['people', 'عدد الأشخاص', 'number-pad'],
  ['inclusions', 'مكونات الباقة'], ['image_url', 'رابط صورة الباقة (اختياري)', 'url'],
];
const emptyOffer = { meal: 'both', north: false, category: 'food', city: '' };

const voucherLabels = { active: 'ساري', used: 'مستخدم', expired: 'منتهي', unavailable: 'غير متاح' };
const voucherKey = (uid, offerId) => 'baqat.voucher.' + encodeURIComponent(uid).replace(/%/g, '-') + '.' + offerId;

function Mobile() {
  const [screen, setScreen] = useState('welcome');
  const [filters, setFilters] = useState({ day: riyadhDay(), people: '1', budget: '', meal: 'both', city: '', category: 'all', q: '' });
  const [advanced, setAdvanced] = useState(false);
  const [applied, setApplied] = useState(filters);
  const [admin, setAdmin] = useState(false);
  const [reviews, setReviews] = useState(null);
  const [status, setStatus] = useState('pending');
  const [merchantQuery, setMerchantQuery] = useState('');
  const [sort, setSort] = useState('default');
  const [preview, setPreview] = useState(false);
  const [favorites, setFavorites] = useState({});
  const [loadedFavorites, setLoadedFavorites] = useState(false);
  const [offers, setOffers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [offer, setOffer] = useState(null);
  const [restaurant, setRestaurant] = useState(null);
  const [token, setToken] = useState(null);
  const [phone, setPhone] = useState('');
  const [sms, setSms] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [emailMode, setEmailMode] = useState(false);
  const [linkingPhone, setLinkingPhone] = useState(false);
  const firebase = phoneAuth();
  const [merchant, setMerchant] = useState(null);
  const [merchantOffers, setMerchantOffers] = useState([]);
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [merchantName, setMerchantName] = useState('');
  const [draft, setDraft] = useState(emptyOffer);
  const [editingOffer, setEditingOffer] = useState(null);
  const [codeInput, setCodeInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [vouchers, setVouchers] = useState({});
  const [receipts, setReceipts] = useState(null);
  const [receiptCode, setReceiptCode] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const running = useRef(false);
  const scroll = useRef(null);

  function navigate(next) {
    setNote('');
    setScanning(false);
    setScreen(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }

  function signOut() {
    token?.close();
    setScanning(false);
    setCodeInput('');
    setToken(null);
    setChallenge(null);
    setSms('');
    setLinkingPhone(false);
    setMerchant(null);
    setAdmin(false);
    setReviews(null);
    setStatus('pending');
    setMerchantQuery('');
    setMerchantOffers([]);
    cancelEdit();
    setVouchers({});
    setReceipts(null);
    setReceiptCode(null);
  }

  async function run(action) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNote('');
    try {
      await action();
    } catch (error) {
      if (error.message === 'AUTH_REQUIRED') signOut();
      setNote(errorMessage(error));
      scroll.current?.scrollTo({ y: 0, animated: true });
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  async function search(showResults = false) {
    const searchFilters = showResults ? filters : applied;
    const day = normalize(searchFilters.day);
    const people = Number(normalize(searchFilters.people));
    const budget = searchFilters.budget.trim() ? Math.round(Number(normalize(searchFilters.budget)) * 100) : 10000000;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(people) || people < 1 || people > 100 ||
        !Number.isFinite(budget) || budget < 100 || budget > 10000000) throw new Error('INVALID_INPUT');
    const query = Object.entries({ ...searchFilters, day, people, budget })
      .map(([key, value]) => key + '=' + encodeURIComponent(value)).join('&');
    const results = await api('offers?' + query);
    setOffers(results);
    if (showResults) { setApplied(searchFilters); setPreview(false); navigate('results'); }
    setSearched(true);
    setSelected(current => results.filter(item => current.some(chosen => chosen.id === item.id)));
  }

  useEffect(() => {
    let mounted = true;
    Promise.all([AsyncStorage.getItem('baqat-welcome'), AsyncStorage.getItem('baqat-favorites')])
      .then(([seen, saved]) => {
        if (!mounted) return;
        if (saved) setFavorites(JSON.parse(saved));
        if (seen) setScreen(current => current === 'welcome' ? 'home' : current);
      }).catch(() => {}).finally(() => { if (mounted) setLoadedFavorites(true); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (loadedFavorites) AsyncStorage.setItem('baqat-favorites', JSON.stringify(favorites)).catch(() => {});
  }, [favorites, loadedFavorites]);

  function begin(next) {
    AsyncStorage.setItem('baqat-welcome', 'yes').catch(() => {});
    navigate(next);
  }

  function toggleFavorite(item) {
    setFavorites(current => {
      const next = { ...current };
      if (next[item.id]) delete next[item.id];
      else next[item.id] = item;
      return next;
    });
  }

  function selectCategory(id) {
    setFilters(current => ({ ...current, category: id, meal: 'both' }));
    navigate('search');
  }

  function showPreview() {
    setPreview(true);
    setSelected([]);
    navigate('results');
  }

  function openOffer(item) {
    setOffer(item);
    navigate('detail');
  }

  function renderOffer(item) {
    return <OfferCard key={item.id} offer={item} saved={Boolean(favorites[item.id])}
      selected={selected.some(chosen => chosen.id === item.id)}
      onOpen={() => openOffer(item)} onCompare={() => toggleCompare(item)}
      onSave={() => toggleFavorite(item)} />;
  }

  async function refreshMerchant(authToken) {
    const { merchant: profile, admin: allowed } = await api('account', { token: authToken });
    setAdmin(allowed);
    setMerchant(profile || null);
    if (profile?.approved) setMerchantOffers(await api('merchant/offers', { token: authToken }));
  }

  async function loadReviews(nextStatus) {
    const data = await api('admin/merchants?status=' + nextStatus + '&q=' + encodeURIComponent(merchantQuery.trim()), { token });
    setStatus(nextStatus);
    setReviews(data);
  }

  async function finishPhone(pending, code) {
    const user = await confirmPhoneCode(firebase, pending, code);
    const session = nativeSession(firebase, user);
    await refreshMerchant(session);
    setToken(session);
    setChallenge(null);
    setSms('');
    setLinkingPhone(false);
    setCredentials({ email: '', password: '' });
    setNote(pending.linkUid ? 'تم ربط جوالك بحسابك الحالي.' : 'تم تسجيل الدخول.');
  }

  function sendPhone() {
    return run(async () => {
      if (!firebase) throw new Error('PHONE_UNCONFIGURED');
      const pending = await requestPhoneCode(firebase, phone, linkingPhone ? {
        email: credentials.email.trim(), password: credentials.password, uid: token.user.id,
      } : null);
      setCredentials({ email: '', password: '' });
      if (pending.automaticCode) await finishPhone(pending, pending.automaticCode);
      else {
        setChallenge(pending);
        setSms('');
        setNote('أدخل رمز التحقق المرسل إلى ' + pending.phone);
      }
    });
  }

  function auth(mode) {
    return run(async () => {
      const email = credentials.email.trim();
      if (!email || credentials.password.length < 8) return setNote('أدخل بريدك وكلمة مرور من ٨ أحرف أو أكثر.');
      const authToken = await authenticate(mode, email, credentials.password);
      setCredentials(current => ({ ...current, password: '' }));
      if (!authToken) return setNote('أرسلنا رابط تأكيد البريد. افتحه ثم سجّل الدخول.');
      await refreshMerchant(authToken);
      setToken(authToken);
      setNote('تم تسجيل الدخول.');
    });
  }

  function openMyVouchers() {
    navigate('my-vouchers');
    setReceiptCode(null);
    setReceipts(null);
    run(async () => setReceipts(await api('vouchers', { token })));
  }

  async function savedVoucher(row) {
    const current = vouchers[row.offer_id];
    if (current?.issued_at === row.issued_at) return current;
    const stored = await SecureStore.getItemAsync(voucherKey(token.user.id, row.offer_id));
    const saved = stored ? JSON.parse(stored) : null;
    return saved?.issued_at === row.issued_at ? saved : null;
  }

  async function showReceipt(receipt) {
    setReceiptCode(null);
    const latest = await api('vouchers', { token });
    setReceipts(latest);
    const row = latest.find(item => item.offer_id === receipt.offer_id && item.issued_at === receipt.issued_at);
    if (row?.status !== 'active') return setNote('الرمز لم يعد ساريًا.');
    const saved = await savedVoucher(row);
    if (!saved) return setNote('الرمز محفوظ على الجهاز اللي أصدره. افتحه هناك أو اطلب رمزًا جديدًا بعد انتهاء صلاحيته.');
    setReceiptCode({ ...row, code: saved.code });
    scroll.current?.scrollTo({ y: 0, animated: true });
  }

  async function openOfferVoucher() {
    const offerId = offer.id;
    let issued;
    try {
      [issued] = await api('vouchers', { token, method: 'POST', body: { offer: offerId } });
    } catch (error) {
      if (!['VOUCHER_ALREADY_ACTIVE', 'ISSUE_DENIED'].includes(error.message)) throw error;
      const latest = await api('vouchers', { token });
      const active = latest.find(row => row.offer_id === offerId && row.status === 'active');
      if (!active) throw error;
      issued = await savedVoucher(active);
      if (!issued) throw new Error('VOUCHER_ON_OTHER_DEVICE');
      setVouchers(current => ({ ...current, [offerId]: issued }));
      navigate('voucher');
      return;
    }
    setVouchers(current => ({ ...current, [offerId]: issued }));
    navigate('voucher');
    try {
      await SecureStore.setItemAsync(voucherKey(token.user.id, offerId), JSON.stringify(issued));
    } catch {
      setNote('ظهر الرمز، لكن تعذّر حفظه على الجهاز.');
    }
  }

  function toggleCompare(item) {
    if (selected.some(chosen => chosen.id === item.id)) setSelected(selected.filter(chosen => chosen.id !== item.id));
    else if (selected.length < 3) setSelected([...selected, item]);
    else setNote('تقدر تقارن ثلاث باقات في المرة الواحدة.');
  }

  function publish(item) {
    return run(async () => {
      await api('merchant/offers/' + item.id, { token, method: 'PATCH', body: { published: !item.published } });
      await refreshMerchant(token);
      if (searched) await search();
    });
  }

  function cancelEdit() {
    setEditingOffer(null);
    setDraft(emptyOffer);
  }

  function editOffer(item) {
    const fields = Object.fromEntries(offerFields.map(([key]) => [key, String(item[key] ?? '')]));
    setDraft({
      ...fields, price: String(item.price_halalas / 100), meal: item.meal, north: Boolean(item.north),
      district: item.district, address: item.address, city: item.city || 'الرياض', category: item.category || 'food',
      location: { latitude: item.latitude, longitude: item.longitude },
      starts_at: item.starts_at, ends_at: item.ends_at,
    });
    setEditingOffer(item.id);
    navigate('offer-editor');
  }

  function saveOffer() {
    return run(async () => {
      const invalid = message => {
        setNote(message);
        scroll.current?.scrollTo({ y: 0, animated: true });
      };
      for (const [key, min, max] of [
        ['name', 2, 120], ['inclusions', 3, 1800],
      ]) {
        const length = (draft[key] || '').trim().length;
        if (length < min || length > max) {
          const label = offerFields.find(field => field[0] === key)[1];
          return invalid(`حقل «${label}» يحتاج من ${min} إلى ${max} حرفًا.`);
        }
      }
      if (!draft.city) return invalid('اختر مدينة الفرع.');
      if (!draft.location) return invalid('حدد موقع الفرع على الخريطة.');
      const { latitude, longitude } = draft.location;
      const people = Number(normalize(draft.people || ''));
      const price = Number(normalize(draft.price || ''));
      const venue = draft.venue?.trim() || merchant.name;
      if (venue.length < 2) return invalid('اسم الفرع يحتاج حرفين على الأقل.');
      if (!(price >= 1 && price <= 100000)) {
        return invalid('أدخل سعرًا بين ريال واحد و100,000 ريال.');
      }
      if (!Number.isInteger(people) || people < 1 || people > 100) {
        return invalid('أدخل عدد الأشخاص كعدد صحيح بين 1 و100.');
      }

      const { starts_at, ends_at } = draft;
      if (!starts_at) return invalid('اختر تاريخ ووقت بداية الباقة.');
      if (!ends_at) return invalid('اختر تاريخ ووقت نهاية الباقة.');
      if (Date.parse(ends_at) <= Math.max(Date.parse(starts_at), Date.now())) {
        return invalid('وقت النهاية لازم يكون بعد وقت البداية وبعد الوقت الحالي.');
      }

      const path = 'merchant/offers' + (editingOffer ? '/' + editingOffer : '');
      await api(path, { token, method: editingOffer ? 'PUT' : 'POST', body: {
        name: draft.name.trim(),
        venue,
        district: draft.district?.trim() || draft.city,
        address: draft.address?.trim() || draft.city,
        city: draft.city,
        category: draft.category,
        meal: draft.meal,
        north: draft.north,
        inclusions: draft.inclusions.trim(),
        image_url: draft.image_url?.trim() || null,
        latitude,
        longitude,
        people,
        price_halalas: Math.round(price * 100),
        starts_at,
        ends_at,
      } });
      cancelEdit();
      await refreshMerchant(token);
      if (searched) await search();
      navigate('merchant');
      setNote(editingOffer ? 'تم حفظ تعديلات الباقة.' : 'تم حفظ المسودة.');
    });
  }

  const activeOffers = preview ? sampleOffers(normalize(filters.day) || riyadhDay()).filter(item =>
    item.people >= Number(normalize(filters.people)) && (!filters.budget.trim() || item.price_halalas <= Number(normalize(filters.budget)) * 100) &&
    (filters.meal === 'both' || item.meal === 'both' || item.meal === filters.meal)) : offers;
  const displayed = [...activeOffers];
  if (sort === 'price') displayed.sort((a, b) => a.price_halalas - b.price_halalas);
  if (sort === 'person') displayed.sort((a, b) => a.price_halalas / a.people - b.price_halalas / b.people);
  const today = riyadhDay();
  const dateAfter = days => new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  const weekday = new Date(today + 'T00:00:00Z').getUTCDay();
  const weekend = dateAfter(weekday === 6 ? 0 : (5 - weekday + 7) % 7);
  const initialMapRegion = displayed.length ? {
    latitude: applied.city && !preview ? displayed[0].latitude : 24.2,
    longitude: applied.city && !preview ? displayed[0].longitude : 44.8,
    latitudeDelta: applied.city && !preview ? 0.3 : 16,
    longitudeDelta: applied.city && !preview ? 0.3 : 23,
  } : null;
  const voucher = offer ? vouchers[offer.id] : null;
  const activeVoucher = voucher && Date.parse(voucher.expires_at) > Date.now();
  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" />
    {screen !== 'welcome' && <View style={styles.header}>
      <View style={styles.brand}><BrandMark />
        <Text style={styles.logo}>باقات</Text></View>
      <Pressable style={styles.cityPill} accessibilityRole="button" onPress={() => navigate('search')}>
        <Icon name="pin" size={18} /><Text style={styles.city} numberOfLines={1}>{filters.city || 'كل المملكة'}</Text>
      </Pressable>
    </View>}
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, screen === 'welcome' && styles.welcomeContent]}>
        {!!note && <Text accessibilityLiveRegion="polite" style={styles.note}>{note}</Text>}
        {busy && <ActivityIndicator accessibilityLabel="جاري التحميل" color={colors.primary} />}
        {screen === 'welcome' && <View style={[styles.hero, styles.welcome]}>
          <View style={styles.welcomeMark}><BrandMark size={52} reversed /></View>
          <Text style={styles.welcomeTitle}>باقات</Text>
          <Text style={styles.heroText}>أفضل الباقات في مكان واحد، بالوقت والمكان اللي تبيه.</Text>
          <View style={styles.collage}>
            <Photo meal="lunch" style={[styles.panelPhoto, styles.leftPhoto]} />
            <Photo meal="dinner" style={styles.panelPhoto} />
            <Photo meal="both" style={[styles.panelPhoto, styles.rightPhoto]} />
          </View>
          <Button label="ابدأ الآن" secondary onPress={() => begin('home')} />
          {!token && <Button label="لديك حساب؟ سجّل الدخول" onPress={() => begin('account')} />}
        </View>}
        {screen === 'home' && <>
          <View style={styles.homeFeature}>
            <View style={styles.heroTicket}><BrandMark size={70} reversed /></View>
            <View style={styles.homeBody}>
              <Text accessibilityRole="header" style={styles.heroTitle}>وش ودّك تسوي اليوم؟</Text>
              <Text style={styles.heroText}>مطاعم وتجارب وأنشطة في كل المملكة.</Text>
              <Button label="ابحث عن باقة" icon="search" secondary onPress={() => navigate('search')} />
            </View>
          </View>
          <Title>تصفّح حسب الفئة</Title>
          <CategoryGrid onSelect={selectCategory} />
          <Button label="جرّب عروضًا افتراضية" secondary onPress={showPreview} />
          <Button label="شاشة الترحيب" secondary onPress={() => navigate('welcome')} />
        </>}
        {screen === 'search' && <Card>
            <Title>ابحث عن باقة</Title>
            <Picker label="المدينة" options={[[ '', 'كل المملكة' ], ...cityOptions]} value={filters.city} custom
              change={city => setFilters(current => ({ ...current, city }))} />
            <Picker label="النشاط" options={categoriesWithAll} value={filters.category}
              change={category => setFilters(current => ({ ...current, category, meal: 'both' }))} />
            <Button label={advanced ? 'إخفاء خيارات البحث' : 'التاريخ والميزانية وخيارات البحث'} secondary
              onPress={() => setAdvanced(!advanced)} />
            {advanced && <>
            <Input label="اسم الباقة أو المنشأة" value={filters.q} maxLength={100}
              onChangeText={q => setFilters(current => ({ ...current, q }))} />
            {filters.category === 'food' && <Choices options={meals} value={filters.meal}
              change={meal => setFilters(current => ({ ...current, meal }))} />}
            <Copy>متى؟</Copy>
            <View style={styles.row}>
              <Button label="اليوم" selected={filters.day === today} secondary={filters.day !== today}
                onPress={() => setFilters(current => ({ ...current, day: today }))} />
              <Button label="نهاية الأسبوع" selected={filters.day !== today && filters.day === weekend}
                secondary={filters.day === today || filters.day !== weekend}
                onPress={() => setFilters(current => ({ ...current, day: weekend }))} />
            </View>
            <OfferDate label="تاريخ الباقة" dateOnly value={filters.day + 'T12:00:00+03:00'}
              onChange={date => setFilters(current => ({ ...current, day: new Date(Date.parse(date) + 3 * 3600000).toISOString().slice(0, 10) }))} />
            <Copy>عدد الأشخاص</Copy>
            <View style={styles.row}>
              <Button label="−" accessibilityLabel="أنقص عدد الأشخاص" secondary disabled={Number(filters.people) <= 1} onPress={() => setFilters({ ...filters, people: String(Number(filters.people) - 1) })} />
              <Text style={styles.stepper}>{filters.people}</Text>
              <Button label="+" accessibilityLabel="زد عدد الأشخاص" secondary disabled={Number(filters.people) >= 100} onPress={() => setFilters({ ...filters, people: String(Number(filters.people) + 1) })} />
            </View>
            <Input label="الميزانية القصوى بالريال (اختياري)" value={filters.budget} keyboardType="decimal-pad" ltr
              onChangeText={budget => setFilters({ ...filters, budget })} />
            </>}
            <Button label="اعرض الباقات المناسبة" disabled={busy} onPress={() => run(() => search(true))} />
        </Card>}
        {screen === 'results' && <>
          <Card>
            <Title>{preview ? 'باقات تجريبية' : 'نتائج البحث'}</Title>
            <Copy>{preview ? 'أمثلة من الرياض' : (applied.city || 'كل المملكة') + ' · ' + categoriesWithAll.find(([id]) => id === applied.category)?.[1]}</Copy>
            {!preview && <Copy>{applied.day} · {applied.people} {applied.people === '1' ? 'شخص' : 'أشخاص'}{applied.budget.trim() ? ' · حتى ' + money(Math.round(Number(normalize(applied.budget)) * 100)) : ''}</Copy>}
            {preview && <Copy>أمثلة افتراضية لتجربة التطبيق.</Copy>}
            <View style={styles.row}>
              <Button label="عدّل البحث" secondary onPress={() => navigate('search')} />
              <Button label="الخريطة" secondary disabled={!displayed.length} onPress={() => navigate('map')} />
            </View>
          </Card>
          <Choices options={[['default', 'نتائج البحث'], ['price', 'الأقل سعرًا'], ['person', 'الأقل للشخص']]} value={sort} change={setSort} />
          {selected.length >= 2 && <Button label={'قارن الباقات (' + selected.length + ')'} onPress={() => navigate('compare')} />}
          {displayed.length > 0 && <Title>الباقات المطابقة ({displayed.length})</Title>}
          {!busy && !displayed.length && <Card>
            <Title>ما لقينا باقات مطابقة</Title>
            <Copy>جرّب تاريخًا آخر أو وسّع نطاق البحث.</Copy>
            {!preview && <Button label="استعرض باقات تجريبية" secondary onPress={showPreview} />}
          </Card>}
          {displayed.map(renderOffer)}
        </>}
        {screen === 'favorites' && <>
          <Title>المفضلة</Title>
          {!Object.keys(favorites).length && <Card><Copy>احفظ الباقات اللي تعجبك عشان ترجع لها هنا.</Copy>
            <Button label="تصفح الباقات" onPress={() => navigate('results')} /></Card>}
          {Object.values(favorites).map(renderOffer)}
          {selected.length >= 2 && <Button label="قارن المختار" onPress={() => navigate('compare')} />}
        </>}
        {screen === 'map' && displayed.length > 0 && <>
          <Title>الباقات على الخريطة</Title>
          {preview && <Copy>المواقع المعروضة أمثلة افتراضية.</Copy>}
          {Platform.OS === 'ios' && <MapView style={styles.map} initialRegion={initialMapRegion}>
            {displayed.map(item => <Marker key={item.id}
              coordinate={{ latitude: item.latitude, longitude: item.longitude }}
              title={item.name} description={money(item.price_halalas)} onCalloutPress={() => openOffer(item)} />)}
          </MapView>}
          {Platform.OS !== 'ios' && <Copy>اختر الباقة لعرض موقع الفرع والاتجاهات.</Copy>}
          {displayed.map(item => <Button key={item.id} label={item.name + ' · ' + money(item.price_halalas)}
            secondary onPress={() => openOffer(item)} />)}
        </>}
        {screen === 'compare' && <>
          <Title>مقارنة الباقات</Title>
          {selected.map(item => <Card key={item.id}>
            <Photo uri={item.image_url} meal={item.meal} category={item.category} /><Title>{item.name}</Title><Text style={styles.price}>{money(item.price_halalas)}</Text>
            <Copy>{item.venue} · {item.district} · حتى {item.people} أشخاص</Copy>
            <Copy>{item.inclusions}</Copy><Copy>{riyadhTime(item.starts_at)} إلى {riyadhTime(item.ends_at)}</Copy>
            <Button label="عرض التفاصيل" onPress={() => { setOffer(item); navigate('detail'); }} />
          </Card>)}
          <Button label="العودة إلى الباقات" secondary onPress={() => navigate('results')} />
        </>}
        {screen === 'restaurant' && restaurant && <>
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>{restaurant.name}</Text>
            <Text style={styles.heroText}>باقات المنشأة</Text>
          </View>
          {!restaurant.offers.length && <Card><Copy>ما فيه باقات متاحة حاليًا.</Copy></Card>}
          {restaurant.offers.map(item => <OfferCard key={item.id} offer={item}
            onOpen={() => openOffer(item)} saved={!!favorites[item.id]}
            onSave={() => toggleFavorite(item)} selected={selected.some(chosen => chosen.id === item.id)}
            onCompare={() => toggleCompare(item)} />)}
        </>}
        {screen === 'detail' && offer && <Card>
          <Photo uri={offer.image_url} meal={offer.meal} category={offer.category} style={styles.detailPhoto} />
          {offer.sample && <Copy>عرض تجريبي · الصور توضيحية</Copy>}
          <Title>{offer.name}</Title><Text style={styles.price}>{money(offer.price_halalas)}</Text>
          <Copy>{offer.venue} · {offer.city || 'الرياض'} · {offer.district} · حتى {offer.people} أشخاص</Copy>
          {!offer.sample && <Button label="عرض صفحة المنشأة" secondary disabled={busy}
            onPress={() => run(async () => {
              setRestaurant(await api('offers/' + offer.id + '/restaurant'));
              navigate('restaurant');
            })} />}
          <Title>محتويات الباقة</Title>
          <Copy>{offer.inclusions}</Copy>{offer.address && offer.address !== offer.district && <Copy>{offer.address}</Copy>}
          <Copy>{riyadhTime(offer.starts_at)} إلى {riyadhTime(offer.ends_at)}</Copy>
          <Button label="الاتجاهات إلى الفرع" secondary onPress={() => run(() => Linking.openURL(
            'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(offer.latitude + ',' + offer.longitude)))} />
          <Button label={favorites[offer.id] ? 'محفوظة' : 'حفظ في المفضلة'} icon="heart" filled={!!favorites[offer.id]} selected={!!favorites[offer.id]} secondary onPress={() => toggleFavorite(offer)} />
          {offer.sample ? <Button label="معاينة شاشة الرمز" onPress={() => navigate('voucher')} /> :
            <Button label={!token ? 'سجّل الدخول لطلب الرمز' : activeVoucher ? 'اعرض رمز الباقة' : 'اطلب رمز الباقة'}
              disabled={busy} onPress={() => token ? run(openOfferVoucher) : navigate('account')} />}
        </Card>}
        {screen === 'voucher' && offer && <Card>
          <Title>{offer.sample ? 'معاينة رمز الباقة' : 'رمز الباقة جاهز'}</Title>
          <Title>{offer.name}</Title>
          {offer.sample ? <Copy>شاشة توضيحية. الرموز القابلة للاستخدام تصدر من الباقات الحقيقية.</Copy> :
            activeVoucher ? <>
              <View style={styles.qr}><QRCode value={voucher.code} size={188} /></View>
              <Text selectable style={styles.code}>{voucher.code}</Text>
              <Copy>ينتهي الرمز في {riyadhTime(voucher.expires_at)}</Copy>
            </> : <Copy>الرمز غير متاح أو انتهت صلاحيته.</Copy>}
          <Button label="العودة للتفاصيل" secondary onPress={() => navigate('detail')} />
        </Card>}
        {screen === 'my-vouchers' && token && <>
          <Title>رموزي</Title>
          <Button label="تحديث الحالات" secondary disabled={busy} onPress={openMyVouchers} />
          {receiptCode && <Card>
            <Title>{receiptCode.name}</Title>
            <View style={styles.qr}><QRCode value={receiptCode.code} size={188} /></View>
            <Text selectable style={styles.code}>{receiptCode.code}</Text>
            <Copy>ينتهي في {riyadhTime(receiptCode.expires_at)}</Copy>
          </Card>}
          {receipts?.length === 0 && <Copy>ما أصدرت أي رمز إلى الآن.</Copy>}
          {receipts?.map(item => <Card key={item.offer_id + item.issued_at}>
            <Title>{item.name}</Title>
            <Copy>{item.venue} · {voucherLabels[item.status]}</Copy>
            <Copy>{riyadhTime(item.redeemed_at || item.expires_at)}</Copy>
            {item.status === 'active' && <Button label="اعرض الرمز" disabled={busy}
              onPress={() => run(() => showReceipt(item))} />}
          </Card>)}
        </>}
        {screen === 'account' && <>
          <View style={styles.hero}>
            <Text accessibilityRole="header" style={styles.heroTitle}>{merchant?.name || 'حسابي'}</Text>
            <Text style={styles.heroText}>{admin ? 'إدارة باقات' : merchant?.approved ? 'حساب مقدم خدمة' : token ? 'حساب العميل' : 'سجّل الدخول للوصول إلى حسابك'}</Text>
          </View>
          {(!token && firebase && !emailMode || linkingPhone) && <Card>
            <Title>{linkingPhone ? 'اربط جوالك بحسابك الحالي' : 'الدخول برقم الجوال'}</Title>
            {!challenge ? <>
              {linkingPhone && <>
                <Input label="البريد المسجل" value={credentials.email} autoCapitalize="none" keyboardType="email-address" ltr
                  onChangeText={email => setCredentials(current => ({ ...current, email }))} />
                <Input label="كلمة مرور حسابك الحالي" value={credentials.password} secureTextEntry ltr
                  onChangeText={password => setCredentials(current => ({ ...current, password }))} />
              </>}
              <Input label="رقم الجوال السعودي" value={phone} onChangeText={setPhone} keyboardType="phone-pad" ltr placeholder="05XXXXXXXX" />
              <Copy>بنرسل لك رمز تحقق عبر رسالة نصية. يعالج Firebase رقمك لإتمام التحقق ومنع إساءة الاستخدام.</Copy>
              <Button label="أرسل رمز التحقق" disabled={busy} onPress={sendPhone} />
            </> : <>
              <Input label="رمز التحقق" value={sms} onChangeText={setSms} keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} ltr />
              <Button label="تحقق" disabled={busy} onPress={() => run(() => finishPhone(challenge, normalize(sms)))} />
              <Button label="غيّر الرقم أو أعد الطلب" secondary disabled={busy} onPress={() => { setChallenge(null); setSms(''); }} />
            </>}
            <Button label={linkingPhone ? 'إلغاء الربط' : 'عندي حساب بالبريد'} secondary disabled={busy} onPress={() => {
              setChallenge(null); setSms('');
              if (linkingPhone) setLinkingPhone(false); else setEmailMode(true);
            }} />
          </Card>}
          {!token && (!firebase || emailMode) && <Card>
            <Input label="البريد الإلكتروني" value={credentials.email} keyboardType="email-address" autoCapitalize="none" ltr
              onChangeText={email => setCredentials({ ...credentials, email })} />
            <Input label="كلمة المرور" value={credentials.password} secureTextEntry ltr
              onChangeText={password => setCredentials({ ...credentials, password })} />
            <Button label="دخول" disabled={busy} onPress={() => auth('login')} />
            <Button label="إنشاء حساب" secondary disabled={busy} onPress={() => auth('register')} />
            <Button label="إعادة إرسال تأكيد البريد" secondary disabled={busy} onPress={() => auth('verify')} />
            {firebase && <Button label="الدخول بالجوال" secondary disabled={busy} onPress={() => setEmailMode(false)} />}
          </Card>}
          {token && !linkingPhone && <>
            {admin && <Button label="لوحة الإدارة" disabled={busy} onPress={() => run(async () => {
              await loadReviews(status);
              navigate('admin');
            })} />}
            <Button label="رموزي" disabled={busy} onPress={openMyVouchers} />
            {firebase && !firebase.currentUser?.phoneNumber && <Button label="اربط رقم جوالك بحسابك" secondary disabled={busy}
              onPress={() => setLinkingPhone(true)} />}
            {!merchant && <Card>
              <Input label="اسم المنشأة" value={merchantName} onChangeText={setMerchantName} />
              <Button label="أضف منشأتك" disabled={busy} onPress={() => run(async () => {
                await api('merchant', { token, method: 'POST', body: { name: merchantName } });
                await refreshMerchant(token);
              })} />
            </Card>}
            {merchant && !merchant.approved && <Card>
              <Copy>طلب «{merchant.name}» بانتظار المراجعة.</Copy>
              <Button label="تحديث حالة الطلب" secondary disabled={busy} onPress={() => run(() => refreshMerchant(token))} />
            </Card>}
            {merchant?.approved ? <Button label="لوحة منشأتي" onPress={() => navigate('merchant')} /> : null}
            <Button label="تسجيل الخروج" disabled={busy} secondary onPress={() => { signOut(); setNote('تم تسجيل الخروج.'); }} />
          </>}
        </>}
        {screen === 'admin' && admin && <>
          <View style={styles.hero}>
            <Text accessibilityRole="header" style={styles.heroTitle}>لوحة الإدارة</Text>
            <Text style={styles.heroText}>{reviews?.pending} بانتظار المراجعة · {reviews?.approved} منشأة معتمدة</Text>
          </View>
          <Card>
            <Input label="ابحث باسم المنشأة" maxLength={100} value={merchantQuery} onChangeText={setMerchantQuery} />
            <Button label="ابحث" secondary disabled={busy} onPress={() => run(() => loadReviews(status))} />
          </Card>
          <Choices options={[[ 'pending', 'طلبات المراجعة' ], [ 'approved', 'المنشآت المعتمدة' ]]}
            value={status} change={nextStatus => run(() => loadReviews(nextStatus))} />
          {reviews?.merchants.length === 0 && <Card><Copy>لا توجد منشآت في هذه القائمة.</Copy></Card>}
          {reviews?.merchants.map(item => <Card key={item.user_id}>
            <Title>{item.name}</Title>
            <Button label={status === 'pending' ? 'اعتماد المنشأة' : 'إيقاف اعتماد المنشأة'}
              disabled={busy} onPress={() => run(async () => {
                await api('admin/merchants', { method: 'POST', token, body: {
                  user_id: item.user_id, approved: status === 'pending',
                } });
                await loadReviews(status);
              })} />
          </Card>)}
        </>}
        {screen === 'merchant' && merchant?.approved ? <>
          <View style={styles.hero}>
            <Text style={styles.heroText}>لوحة المنشأة</Text>
            <Text style={styles.heroTitle}>{merchant.name}</Text>
            <View style={styles.row}>
              <Button label="أضف باقة" secondary onPress={() => { cancelEdit(); navigate('offer-editor'); }} />
              <Button label="استخدم رمز عميل" secondary onPress={() => navigate('merchant-redeem')} />
            </View>
          </View>
          <Title>باقاتي</Title>
          {!merchantOffers.length && <Card><Copy>ما أضفت أي باقة إلى الآن.</Copy></Card>}
          {merchantOffers.map(item => {
            const expired = Date.parse(item.ends_at) <= Date.now();
            return <Card key={item.id}>
              <View style={styles.offerRow}>
                <View style={styles.offerText}>
                  <Text style={styles.sample}>{expired ? 'منتهية' : item.published ? 'منشورة' : 'مسودة'}</Text>
                  <Title>{item.name}</Title>
                  <Copy>{money(item.price_halalas)} · {item.people} أشخاص</Copy>
                  <Copy>حتى {riyadhTime(item.ends_at)}</Copy>
                </View>
                <Photo uri={item.image_url} meal={item.meal} category={item.category} style={styles.thumbnail} />
              </View>
              <View style={styles.row}>
                <Button label="تعديل" secondary disabled={busy} onPress={() => editOffer(item)} />
                <Button label={item.published ? 'أوقف النشر' : 'انشر الباقة'}
                  disabled={busy || (expired && !item.published)} onPress={() => publish(item)} />
              </View>
            </Card>;
          })}
        </> : null}
        {screen === 'merchant-redeem' && merchant?.approved ? <>
          <Button label="العودة إلى لوحة المنشأة" secondary onPress={() => navigate('merchant')} />
          <Card>
            <Title>استخدام رمز العميل</Title>
            <Button label="امسح رمز العميل" secondary disabled={busy} onPress={() => setScanning(true)} />
            {scanning && <VoucherScanner onClose={() => setScanning(false)} onScan={code => {
              setCodeInput(code);
              setScanning(false);
              setNote('تمت قراءة الرمز. اضغط «استخدم الرمز» للتأكيد.');
            }} />}
            <Input label="رمز الباقة" value={codeInput} autoCapitalize="none" ltr onChangeText={setCodeInput} />
            <Button label="استخدم الرمز" disabled={busy} onPress={() => run(async () => {
              const code = voucherCode(codeInput);
              if (!code) return setNote('أدخل رمز باقات كاملًا أو امسحه بالكاميرا.');
              const [used] = await api('vouchers/redeem', { token, method: 'POST', body: { code } });
              if (used) setCodeInput('');
              setNote(used ? 'تم استخدام رمز «' + used.offer_name + '».' : 'الرمز غير متاح للاستخدام.');
              scroll.current?.scrollTo({ y: 0, animated: true });
            })} />
          </Card>
        </> : null}
        {screen === 'offer-editor' && merchant?.approved ? <>
          <Button label="العودة إلى لوحة المنشأة" secondary disabled={busy} onPress={() => navigate('merchant')} />
          <Title>{editingOffer ? 'تعديل الباقة' : 'باقة جديدة'}</Title>
          <Card>
            <Title>تفاصيل الباقة</Title>
            {offerFields.map(([key, label, keyboard]) => <Input key={key} label={label}
              value={draft[key] || ''} keyboardType={keyboard || 'default'} ltr={!!keyboard}
              maxLength={{ name: 120, venue: 120, inclusions: 1800, image_url: 2048 }[key]}
              multiline={key === 'inclusions'}
              onChangeText={value => setDraft(current => ({ ...current, [key]: value }))} />)}
            <Picker label="نشاط الباقة" options={categories} value={draft.category}
              change={category => setDraft(current => ({ ...current, category, meal: 'both' }))} />
            {draft.category === 'food' && <Choices options={meals} value={draft.meal}
              change={meal => setDraft(current => ({ ...current, meal }))} />}
          </Card>
          <Card>
            <Title>الموقع</Title>
            <Picker label="مدينة الفرع" options={cityOptions} value={draft.city} custom
              change={city => setDraft(current => ({ ...current, city, north: city === current.city && current.north, district: city === current.city ? current.district : '',
                address: city === current.city ? current.address : '', location: city === current.city ? current.location : null }))} />
            <Input label="الحي" value={draft.district || ''} maxLength={80}
              onChangeText={district => setDraft(current => ({ ...current, district }))} />
            <Input label="العنوان" value={draft.address || ''} maxLength={240}
              onChangeText={address => setDraft(current => ({ ...current, address }))} />
            <OfferLocation location={draft.location}
              onChange={location => setDraft(current => ({ ...current, location }))} />
          </Card>
          <Card>
            <Title>فترة التوفر</Title>
            <OfferDate label="البداية" value={draft.starts_at}
              onChange={starts_at => setDraft(current => ({ ...current, starts_at }))} />
            <OfferDate label="النهاية" value={draft.ends_at}
              suggested={draft.starts_at && Date.parse(draft.starts_at) + 3600000}
              onChange={ends_at => setDraft(current => ({ ...current, ends_at }))} />
          </Card>
          <Button label={editingOffer ? 'احفظ التعديلات' : 'احفظ المسودة'} disabled={busy} onPress={saveOffer} />
        </> : null}
      </ScrollView>
    </KeyboardAvoidingView>
    {screen !== 'welcome' && <View style={styles.footer}>
      {[['home', 'home', 'الرئيسية'], ['results', 'search', 'الباقات'], ['favorites', 'heart', 'المفضلة'], ['account', 'account', 'حسابي']]
        .map(([target, icon, label]) => <Pressable key={target} accessibilityRole="tab"
          accessibilityState={{ selected: screen === target }} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          onPress={() => {
            if (target === 'results' && !searched && !preview) { navigate('results'); run(() => search(true)); }
            else navigate(target);
          }}>
          <View style={[styles.tabIcon, screen === target && styles.tabIconActive]}><Icon name={icon} color={screen === target ? colors.primary : colors.muted} /></View>
          <Text style={[styles.tabLabel, screen === target && styles.tabActive]}>{label}</Text>
        </Pressable>)}
    </View>}
  </SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><Mobile /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  brand: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flexShrink: 1 },
  cityPill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, maxWidth: '55%', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FFC83D', borderRadius: 16 },
  logo: { color: colors.primary, fontSize: 28, fontWeight: '900' },
  city: { flexShrink: 1, color: colors.ink, fontSize: 15 },
  content: { padding: 16, paddingBottom: 32, gap: 16, width: '100%', maxWidth: 640, alignSelf: 'center' },
  hero: { backgroundColor: colors.primary, padding: 22, borderRadius: 20, gap: 7 },
  heroTitle: { color: 'white', fontSize: 29, fontWeight: '900', textAlign: 'right' },
  heroText: { color: colors.onDeep, fontSize: 16, textAlign: 'right', lineHeight: 25 },
  card: { backgroundColor: 'white', borderColor: colors.border, borderWidth: 1, padding: 16, gap: 12, borderRadius: 16 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '800', textAlign: 'right' },
  copy: { color: colors.muted, fontSize: 16, textAlign: 'right', lineHeight: 24 },
  price: { color: colors.primary, fontSize: 24, fontWeight: '800', textAlign: 'right' },
  row: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  button: { minWidth: 48, minHeight: 48, flexShrink: 1, flexDirection: 'row-reverse', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 },
  buttonText: { flexShrink: 1, color: 'white', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  secondary: { backgroundColor: colors.soft },
  secondaryText: { color: colors.primary },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
  field: { gap: 5 },
  label: { fontSize: 15, color: '#352642', textAlign: 'right' },
  input: { borderWidth: 1, borderColor: colors.outline, borderRadius: 9, padding: 9, minHeight: 48, fontSize: 16, color: colors.ink, textAlign: 'right' },
  inputFocused: { borderColor: colors.primary, backgroundColor: colors.soft },
  ltr: { textAlign: 'left', writingDirection: 'ltr' },
  note: { padding: 12, backgroundColor: colors.soft, borderRadius: 10, color: '#44205f', fontSize: 16, textAlign: 'right' },
  code: { textAlign: 'center', writingDirection: 'ltr', fontSize: 16, padding: 12, backgroundColor: colors.soft, color: '#44205f', borderRadius: 10 },
  welcomeContent: { flexGrow: 1, paddingBottom: 16 },
  welcome: { flexGrow: 1, justifyContent: 'center', gap: 16, backgroundColor: colors.deep },
  welcomeTitle: { textAlign: 'center', color: '#fff', fontSize: 44, fontWeight: '900' },
  welcomeMark: { alignSelf: 'center', backgroundColor: '#5B2EFF', padding: 12, borderRadius: 20 },
  collage: { flexDirection: 'row', gap: 7, paddingHorizontal: 4, marginVertical: 16 },
  panelPhoto: { flex: 1, width: 0, height: 124, borderWidth: 2, borderColor: '#f5eaff' },
  leftPhoto: { transform: [{ rotate: '-7deg' }], marginTop: 12 },
  rightPhoto: { transform: [{ rotate: '7deg' }], marginTop: 12 },
  offerRow: { flexDirection: 'row-reverse', gap: 12, alignItems: 'center' },
  offerText: { flex: 1, gap: 4 },
  thumbnail: { width: 92, height: 104 },
  sample: { color: '#4f356a', backgroundColor: '#FFDFED', fontWeight: '700', alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  homeFeature: { overflow: 'hidden', borderRadius: 24, backgroundColor: colors.deep },
  heroTicket: { alignSelf: 'flex-end', backgroundColor: colors.primary, margin: 16, marginBottom: 0, borderRadius: 22 },
  homeBody: { gap: 12, padding: 16 },
  listing: { padding: 0, gap: 0, overflow: 'hidden' },
  listingLink: { minHeight: 48 },
  listingPhoto: { height: 148, borderRadius: 0 },
  listingDetails: { gap: 4, padding: 16 },
  listingMeta: { flexDirection: 'row-reverse', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  listingActions: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.border },
  map: { width: '100%', height: 310, borderRadius: 16 },
  qr: { alignItems: 'center', padding: 14 },
  detailPhoto: { height: 210 },
  stepper: { fontSize: 18, padding: 12, color: colors.primary },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  tabIcon: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  tabIconActive: { backgroundColor: colors.soft },
  tabLabel: { color: colors.muted, fontSize: 13 },
  tabActive: { color: colors.primary, fontWeight: '900' },
  footer: { backgroundColor: 'white', flexDirection: 'row-reverse', justifyContent: 'space-evenly', paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border },
});
