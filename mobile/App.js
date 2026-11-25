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
const areas = [['north', 'شمال الرياض'], ['all', 'كل الرياض']];
const money = amount => new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 }).format(amount / 100) + ' ريال';
const normalize = value => value.trim().replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)).replace(/٫/g, '.');

function Button({ label, onPress, secondary = false, disabled = false }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}

function Input({ label, value, onChangeText, ltr, inputRef, ...props }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput ref={inputRef} accessibilityLabel={label} value={value} onChangeText={onChangeText}
      style={[styles.input, ltr && styles.ltr]} placeholderTextColor="#766883" {...props} />
  </View>;
}

function Choices({ options, value, change }) {
  return <View style={styles.row}>{options.map(([id, label]) =>
    <Button key={id} label={label} secondary={value !== id} onPress={() => change(id)} />)}</View>;
}

function Card({ children }) { return <View style={styles.card}>{children}</View>; }
function Title({ children }) { return <Text accessibilityRole="header" style={styles.title}>{children}</Text>; }
function Copy({ children }) { return <Text style={styles.copy}>{children}</Text>; }

function OfferCard({ offer, onOpen, selected, onCompare, saved, onSave }) {
  return <Card>
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={'تفاصيل ' + offer.name} style={styles.offerRow}>
      <View style={styles.offerText}>
        {offer.sample && <Text style={styles.sample}>عرض تجريبي</Text>}
        <Title>{offer.name}</Title>
        <Copy>{offer.venue} · {offer.district}</Copy>
        <Text style={styles.price}>{money(offer.price_halalas)}</Text>
        <Copy>حتى {offer.people} أشخاص</Copy>
      </View>
      <Photo meal={offer.meal} style={styles.thumbnail} />
    </Pressable>
    <View style={styles.row}>
      <Button label="التفاصيل" onPress={onOpen} />
      <Button label={saved ? "♥ محفوظة" : "♡ حفظ"} secondary onPress={onSave} />
      <Button label={selected ? 'إلغاء الاختيار' : 'قارن'} onPress={onCompare} secondary />
    </View>
  </Card>;
}

const offerFields = [
  ['name', 'اسم الباقة'], ['venue', 'اسم الفرع'], ['district', 'الحي'], ['address', 'العنوان'],
  ['latitude', 'خط العرض', true], ['longitude', 'خط الطول', true], ['price', 'السعر النهائي بالريال', true],
  ['people', 'عدد الأشخاص', true], ['inclusions', 'مكونات الباقة'],
  ['starts_at', 'البداية بتوقيت الرياض', false, '2026-12-01 12:00'],
  ['ends_at', 'النهاية بتوقيت الرياض', false, '2026-12-01 22:00'],
];
const emptyOffer = { meal: 'both', north: true };

function Mobile() {
  const [screen, setScreen] = useState('welcome');
  const [filters, setFilters] = useState({ day: riyadhDay(), people: '2', budget: '200', meal: 'both', area: 'north' });
  const [category, setCategory] = useState('food');
  const [sort, setSort] = useState('default');
  const [preview, setPreview] = useState(false);
  const [favorites, setFavorites] = useState({});
  const [loadedFavorites, setLoadedFavorites] = useState(false);
  const [offers, setOffers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [offer, setOffer] = useState(null);
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
  const [vouchers, setVouchers] = useState({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const running = useRef(false);
  const scroll = useRef(null);
  const dateInput = useRef(null);

  function navigate(next) {
    setNote('');
    setScreen(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }

  function signOut() {
    token?.close();
    setToken(null);
    setChallenge(null);
    setSms('');
    setLinkingPhone(false);
    setMerchant(null);
    setMerchantOffers([]);
    cancelEdit();
    setVouchers({});
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
    const day = normalize(filters.day);
    const people = Number(normalize(filters.people));
    const budget = Math.round(Number(normalize(filters.budget)) * 100);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(people) || people < 1 || people > 100 ||
        !Number.isFinite(budget) || budget < 100 || budget > 10000000) throw new Error('INVALID_INPUT');
    const query = Object.entries({ ...filters, day, people, budget })
      .map(([key, value]) => key + '=' + encodeURIComponent(value)).join('&');
    const results = await api('offers?' + query);
    setOffers(results);
    if (showResults) { setPreview(false); navigate('results'); }
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
    setCategory(id);
    navigate(id === 'food' ? 'search' : 'category');
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
    const [profile] = await api('merchant', { token: authToken });
    setMerchant(profile || null);
    if (profile?.approved) setMerchantOffers(await api('merchant/offers', { token: authToken }));
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
    const localTime = value => new Date(Date.parse(value) + 3 * 3600000)
      .toISOString().slice(0, 16).replace('T', ' ');
    const fields = Object.fromEntries(offerFields.map(([key]) => [key, String(item[key] ?? '')]));
    setDraft({
      ...fields, price: String(item.price_halalas / 100), meal: item.meal, north: Boolean(item.north),
      starts_at: localTime(item.starts_at), ends_at: localTime(item.ends_at),
    });
    setEditingOffer(item.id);
    scroll.current?.scrollToEnd({ animated: true });
  }

  function saveOffer() {
    return run(async () => {
      const time = key => {
        const value = normalize(draft[key] || '').replace(' ', 'T');
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('INVALID_INPUT');
        return value + ':00+03:00';
      };
      const path = 'merchant/offers' + (editingOffer ? '/' + editingOffer : '');
      await api(path, { token, method: editingOffer ? 'PUT' : 'POST', body: {
        ...draft,
        latitude: Number(normalize(draft.latitude || '')),
        longitude: Number(normalize(draft.longitude || '')),
        people: Number(normalize(draft.people || '')),
        price_halalas: Math.round(Number(normalize(draft.price || '')) * 100),
        starts_at: time('starts_at'),
        ends_at: time('ends_at'),
      } });
      cancelEdit();
      await refreshMerchant(token);
      if (searched) await search();
      setNote(editingOffer ? 'تم حفظ تعديلات الباقة.' : 'تم حفظ المسودة.');
    });
  }

  const activeOffers = preview ? sampleOffers(normalize(filters.day) || riyadhDay()).filter(item =>
    item.people >= Number(normalize(filters.people)) && item.price_halalas <= Number(normalize(filters.budget)) * 100 &&
    (filters.meal === 'both' || item.meal === 'both' || item.meal === filters.meal)) : offers;
  const displayed = [...activeOffers];
  if (sort === 'price') displayed.sort((a, b) => a.price_halalas - b.price_halalas);
  if (sort === 'person') displayed.sort((a, b) => a.price_halalas / a.people - b.price_halalas / b.people);
  const dateAfter = days => new Date(Date.parse(riyadhDay() + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  const voucher = offer ? vouchers[offer.id] : null;
  const activeVoucher = voucher && Date.parse(voucher.expires_at) > Date.now();
  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" />
    {screen !== 'welcome' && <View style={styles.header}><Text style={styles.logo}>باقات</Text><Text style={styles.city}>⌖ الرياض</Text></View>}
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, screen === 'welcome' && styles.welcomeContent]}>
        {!!note && <Text accessibilityLiveRegion="polite" style={styles.note}>{note}</Text>}
        {busy && <ActivityIndicator accessibilityLabel="جاري التحميل" color="#512477" />}
        {screen === 'welcome' && <View style={[styles.hero, styles.welcome]}>
          <Text style={styles.welcomeIcon}>🎁</Text>
          <Text style={styles.welcomeTitle}>باقات</Text>
          <Text style={styles.heroText}>أفضل الباقات في مكان واحد، بالوقت والمكان اللي تبيه.</Text>
          <View style={styles.collage}>
            <Photo meal="lunch" style={[styles.panelPhoto, styles.leftPhoto]} />
            <Photo meal="dinner" style={styles.panelPhoto} />
            <Photo meal="both" style={[styles.panelPhoto, styles.rightPhoto]} />
          </View>
          <Button label="ابدأ الآن" secondary onPress={() => begin('home')} />
          <Button label="لديك حساب؟ سجّل الدخول" onPress={() => begin('account')} />
        </View>}
        {screen === 'home' && <>
          <Title>وش تبي تسوي اليوم؟</Title>
          <CategoryGrid onSelect={selectCategory} />
          <Pressable accessibilityRole="button" accessibilityLabel="ابحث عن باقات اليوم" style={styles.today}
            onPress={() => {
              setFilters(current => ({ ...current, day: riyadhDay() }));
              navigate('search');
            }}>
            <View style={styles.offerText}><Text style={styles.todayTitle}>باقات اليوم</Text>
              <Text style={styles.todayCopy}>استعرض الباقات المتاحة اليوم</Text></View>
            <Photo meal="both" style={styles.todayPhoto} />
          </Pressable>
          <Button label="جرّب عروضًا افتراضية" secondary onPress={showPreview} />
        </>}
        {screen === 'category' && <Card>
          <Title>{categories.find(([id]) => id === category)?.[1]}</Title>
          <Copy>هذه الفئة غير متاحة حاليًا. باقات المطاعم هي المتاحة للبحث الآن.</Copy>
          <Button label="تصفح باقات المطاعم" onPress={() => navigate('search')} />
        </Card>}
        {screen === 'search' && <Card>
            <Title>حدد احتياجك</Title>
            <Copy>وش تبي؟</Copy>
            <Choices options={meals} value={filters.meal} change={meal => setFilters({ ...filters, meal })} />
            <Copy>متى؟</Copy>
            <View style={styles.row}>
              <Button label="اليوم" secondary={filters.day !== riyadhDay()} onPress={() => setFilters({ ...filters, day: riyadhDay() })} />
              <Button label="نهاية الأسبوع" secondary onPress={() => {
                const weekday = new Date(riyadhDay() + 'T00:00:00Z').getUTCDay();
                setFilters({ ...filters, day: dateAfter(weekday === 6 ? 0 : (5 - weekday + 7) % 7) });
              }} />
              <Button label="وقت لاحق" secondary onPress={() => dateInput.current?.focus()} />
            </View>
            <Input inputRef={dateInput} label="التاريخ الميلادي" placeholder="YYYY-MM-DD" value={filters.day} ltr
              onChangeText={day => setFilters({ ...filters, day })} />
            <Copy>عدد الأشخاص</Copy>
            <View style={styles.row}>
              <Button label="−" secondary disabled={Number(filters.people) <= 1} onPress={() => setFilters({ ...filters, people: String(Number(filters.people) - 1) })} />
              <Text style={styles.stepper}>{filters.people}</Text>
              <Button label="+" secondary disabled={Number(filters.people) >= 100} onPress={() => setFilters({ ...filters, people: String(Number(filters.people) + 1) })} />
            </View>
            <Input label="الميزانية القصوى بالريال" value={filters.budget} keyboardType="decimal-pad" ltr
              onChangeText={budget => setFilters({ ...filters, budget })} />
            <Copy>المكان</Copy>
            <Choices options={areas} value={filters.area} change={area => setFilters({ ...filters, area })} />
            <Button label="اعرض الباقات المناسبة" disabled={busy} onPress={() => run(() => search(true))} />
        </Card>}
        {screen === 'results' && <>
          <Title>{preview ? 'باقات تجريبية' : 'باقات غداء أو عشاء'}</Title>
          <Copy>{filters.day} · حتى {filters.budget} ريال · {filters.people} أشخاص</Copy>
          {preview && <Copy>أمثلة افتراضية لتجربة التطبيق.</Copy>}
          <View style={styles.row}>
            <Button label="عدّل البحث" secondary onPress={() => navigate('search')} />
            <Button label="الخريطة" secondary disabled={!displayed.length} onPress={() => navigate('map')} />
          </View>
          <Choices options={[['default', 'نتائج البحث'], ['price', 'الأقل سعرًا'], ['person', 'الأقل للشخص']]} value={sort} change={setSort} />
          {selected.length >= 2 && <Button label={'قارن الباقات (' + selected.length + ')'} onPress={() => navigate('compare')} />}
          <Title>{displayed.length ? displayed.length + ' باقات مطابقة' : 'ما لقينا باقات مطابقة'}</Title>
          {!displayed.length && !preview && <Button label="استعرض باقات تجريبية" secondary onPress={showPreview} />}
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
          {Platform.OS === 'ios' && <MapView style={styles.map} initialRegion={{ latitude: displayed[0].latitude,
            longitude: displayed[0].longitude, latitudeDelta: 0.15, longitudeDelta: 0.15 }}>
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
            <Photo meal={item.meal} /><Title>{item.name}</Title><Text style={styles.price}>{money(item.price_halalas)}</Text>
            <Copy>{item.venue} · {item.district} · حتى {item.people} أشخاص</Copy>
            <Copy>{item.inclusions}</Copy><Copy>{riyadhTime(item.starts_at)} إلى {riyadhTime(item.ends_at)}</Copy>
            <Button label="عرض التفاصيل" onPress={() => { setOffer(item); navigate('detail'); }} />
          </Card>)}
          <Button label="العودة إلى الباقات" secondary onPress={() => navigate('results')} />
        </>}
        {screen === 'detail' && offer && <Card>
          <Photo meal={offer.meal} style={styles.detailPhoto} />
          {offer.sample && <Copy>عرض تجريبي · الصور توضيحية</Copy>}
          <Title>{offer.name}</Title><Text style={styles.price}>{money(offer.price_halalas)}</Text>
          <Copy>{offer.venue} · {offer.district} · حتى {offer.people} أشخاص</Copy>
          <Title>محتويات الباقة</Title>
          <Copy>{offer.inclusions}</Copy><Copy>{offer.address}</Copy>
          <Copy>{riyadhTime(offer.starts_at)} إلى {riyadhTime(offer.ends_at)}</Copy>
          <Button label="الاتجاهات إلى الفرع" secondary onPress={() => run(() => Linking.openURL(
            'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(offer.latitude + ',' + offer.longitude)))} />
          <Button label={favorites[offer.id] ? '♥ محفوظة' : '♡ حفظ في المفضلة'} secondary onPress={() => toggleFavorite(offer)} />
          {offer.sample ? <Button label="معاينة شاشة الرمز" onPress={() => navigate('voucher')} /> : activeVoucher ? <>
            <Button label="اعرض رمز الباقة" onPress={() => navigate('voucher')} />
            <Copy>ينتهي الرمز في {riyadhTime(voucher.expires_at)}</Copy>
          </> : <Button label={token ? 'اطلب رمز الباقة' : 'سجّل الدخول لطلب الرمز'} disabled={busy}
            onPress={() => token ? run(async () => {
              const [issued] = await api('vouchers', { token, method: 'POST', body: { offer: offer.id } });
              setVouchers(current => ({ ...current, [offer.id]: issued }));
              navigate('voucher');
            }) : navigate('account')} />}
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
        {screen === 'account' && <>
          <Title>حسابي</Title>
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
        {screen === 'merchant' && merchant?.approved ? <>
          <Title>لوحة {merchant.name}</Title>
          <Card>
            <Title>استخدام رمز العميل</Title>
            <Input label="رمز الباقة" value={codeInput} autoCapitalize="none" ltr onChangeText={setCodeInput} />
            <Button label="استخدم الرمز" disabled={busy} onPress={() => run(async () => {
              const [used] = await api('vouchers/redeem', { token, method: 'POST', body: { code: codeInput.trim().toLowerCase() } });
              if (used) setCodeInput('');
              setNote(used ? 'تم استخدام رمز «' + used.offer_name + '».' : 'الرمز غير متاح للاستخدام.');
              scroll.current?.scrollTo({ y: 0, animated: true });
            })} />
          </Card>
          {merchantOffers.map(item => <Card key={item.id}>
            <Copy>{item.name} · {item.published ? 'منشورة' : 'مسودة'}</Copy>
            <Button label={item.published ? 'أوقف النشر' : 'انشر الباقة'} disabled={busy} onPress={() => publish(item)} />
            <Button label="عدّل الباقة" secondary disabled={busy} onPress={() => editOffer(item)} />
          </Card>)}
          <Card>
            <Title>{editingOffer ? 'تعديل الباقة' : 'أضف باقة'}</Title>
            {offerFields.map(([key, label, numeric, placeholder]) => <Input key={key} label={label}
              value={draft[key] || ''} keyboardType={numeric ? 'decimal-pad' : 'default'}
              placeholder={placeholder} ltr={numeric || !!placeholder}
              onChangeText={value => setDraft(current => ({ ...current, [key]: value }))} />)}
            <Choices options={meals} value={draft.meal} change={meal => setDraft({ ...draft, meal })} />
            <Choices options={[[true, 'شمال الرياض'], [false, 'بقية الرياض']]} value={draft.north}
              change={north => setDraft({ ...draft, north })} />
            <Button label={editingOffer ? 'احفظ التعديلات' : 'احفظ المسودة'} disabled={busy} onPress={saveOffer} />
            {!!editingOffer && <Button label="إلغاء التعديل" secondary disabled={busy} onPress={cancelEdit} />}
          </Card>
        </> : null}
      </ScrollView>
    </KeyboardAvoidingView>
    {screen !== 'welcome' && <View style={styles.footer}>
      {[[ 'home', '⌂', 'الرئيسية'], ['results', '⌕', 'الباقات'], ['favorites', '♡', 'المفضلة'], ['account', '♙', 'حسابي']]
        .map(([target, icon, label]) => <Pressable key={target} accessibilityRole="tab"
          accessibilityState={{ selected: screen === target }} style={styles.tab}
          onPress={() => {
            if (target === 'results' && !searched && !preview) { navigate('results'); run(() => search(true)); }
            else navigate(target);
          }}>
          <Text style={[styles.tabIcon, screen === target && styles.tabActive]}>{icon}</Text>
          <Text style={[styles.tabLabel, screen === target && styles.tabActive]}>{label}</Text>
        </Pressable>)}
    </View>}
  </SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><Mobile /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f6f2f9' },
  flex: { flex: 1 },
  header: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  logo: { color: '#512477', fontSize: 28, fontWeight: '900' },
  city: { color: '#59476a', fontSize: 15 },
  content: { padding: 16, paddingBottom: 32, gap: 14 },
  hero: { backgroundColor: '#512477', padding: 22, borderRadius: 20, gap: 7 },
  heroTitle: { color: 'white', fontSize: 29, fontWeight: '900', textAlign: 'right' },
  heroText: { color: '#f3e6fb', fontSize: 16, textAlign: 'right', lineHeight: 25 },
  card: { backgroundColor: 'white', borderColor: '#e7dced', borderWidth: 1, padding: 16, gap: 12, borderRadius: 16 },
  title: { color: '#2a1838', fontSize: 20, fontWeight: '800', textAlign: 'right' },
  copy: { color: '#493951', fontSize: 16, textAlign: 'right', lineHeight: 24 },
  price: { color: '#512477', fontSize: 24, fontWeight: '800', textAlign: 'right' },
  row: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: '#512477', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 },
  buttonText: { color: 'white', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  secondary: { backgroundColor: '#eee4f5' },
  secondaryText: { color: '#512477' },
  disabled: { opacity: 0.5 },
  field: { gap: 5 },
  label: { fontSize: 15, color: '#352642', textAlign: 'right' },
  input: { borderWidth: 1, borderColor: '#bbaac5', borderRadius: 9, padding: 9, minHeight: 45, fontSize: 16, color: '#2a1838', textAlign: 'right' },
  ltr: { textAlign: 'left', writingDirection: 'ltr' },
  note: { padding: 12, backgroundColor: '#eee4f5', borderRadius: 10, color: '#44205f', fontSize: 16, textAlign: 'right' },
  code: { textAlign: 'center', writingDirection: 'ltr', fontSize: 16, padding: 12, backgroundColor: '#eee4f5', color: '#44205f', borderRadius: 10 },
  welcomeContent: { flexGrow: 1, paddingBottom: 16 },
  welcome: { flexGrow: 1, justifyContent: 'center', gap: 16, backgroundColor: '#39215a' },
  welcomeTitle: { textAlign: 'center', color: '#fff', fontSize: 44, fontWeight: '900' },
  welcomeIcon: { textAlign: 'center', color: '#f5eaff', fontSize: 44 },
  collage: { flexDirection: 'row', gap: 7, paddingHorizontal: 4, marginVertical: 16 },
  panelPhoto: { flex: 1, width: 0, height: 124, borderWidth: 2, borderColor: '#f5eaff' },
  leftPhoto: { transform: [{ rotate: '-7deg' }], marginTop: 12 },
  rightPhoto: { transform: [{ rotate: '7deg' }], marginTop: 12 },
  offerRow: { flexDirection: 'row-reverse', gap: 12, alignItems: 'center' },
  offerText: { flex: 1, gap: 4 },
  thumbnail: { width: 92, height: 104 },
  sample: { color: '#4f356a', backgroundColor: '#f1e7f8', fontWeight: '700', alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  today: { backgroundColor: '#3b245a', flexDirection: 'row-reverse', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16 },
  todayTitle: { color: 'white', textAlign: 'right', fontSize: 19, fontWeight: '800' },
  todayCopy: { color: '#f0e5fa', textAlign: 'right', fontSize: 14 },
  todayPhoto: { width: 94, height: 76 },
  map: { width: '100%', height: 310, borderRadius: 16 },
  qr: { alignItems: 'center', padding: 14 },
  detailPhoto: { height: 210 },
  stepper: { fontSize: 18, padding: 12, color: '#512477' },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  tabIcon: { fontSize: 26, color: '#65566e' },
  tabLabel: { color: '#65566e', fontSize: 13 },
  tabActive: { color: '#512477', fontWeight: '900' },
  footer: { backgroundColor: 'white', flexDirection: 'row-reverse', justifyContent: 'space-evenly', paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#e7dced' },
});
