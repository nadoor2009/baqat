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

function Input({ label, value, onChangeText, ltr, ...props }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText}
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

function OfferCard({ offer, onOpen, selected, onCompare }) {
  return <Card>
    <Title>{offer.name}</Title>
    <Copy>{offer.venue} · {offer.district}</Copy>
    <Text style={styles.price}>{money(offer.price_halalas)}</Text>
    <Copy>حتى {offer.people} أشخاص · {meals.find(([id]) => id === offer.meal)?.[1]}</Copy>
    <View style={styles.row}>
      <Button label="التفاصيل" onPress={onOpen} />
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
  const [screen, setScreen] = useState('search');
  const [filters, setFilters] = useState({ day: riyadhDay(), people: '2', budget: '200', meal: 'both', area: 'north' });
  const [offers, setOffers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [offer, setOffer] = useState(null);
  const [token, setToken] = useState(null);
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

  function navigate(next) {
    setNote('');
    setScreen(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }

  function signOut() {
    token?.close();
    setToken(null);
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

  async function search() {
    const day = normalize(filters.day);
    const people = Number(normalize(filters.people));
    const budget = Math.round(Number(normalize(filters.budget)) * 100);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(people) || people < 1 || people > 100 ||
        !Number.isFinite(budget) || budget < 100 || budget > 10000000) throw new Error('INVALID_INPUT');
    const query = Object.entries({ ...filters, day, people, budget })
      .map(([key, value]) => key + '=' + encodeURIComponent(value)).join('&');
    const results = await api('offers?' + query);
    setOffers(results);
    setSearched(true);
    setSelected(current => results.filter(item => current.some(chosen => chosen.id === item.id)));
  }

  useEffect(() => { run(search); }, []);

  async function refreshMerchant(authToken) {
    const [profile] = await api('merchant', { token: authToken });
    setMerchant(profile || null);
    if (profile?.approved) setMerchantOffers(await api('merchant/offers', { token: authToken }));
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

  const voucher = offer ? vouchers[offer.id] : null;
  const activeVoucher = voucher && Date.parse(voucher.expires_at) > Date.now();
  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" />
    <View style={styles.header}><Text style={styles.logo}>باقات</Text><Text style={styles.city}>الرياض</Text></View>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {!!note && <Text accessibilityLiveRegion="polite" style={styles.note}>{note}</Text>}
        {busy && <ActivityIndicator accessibilityLabel="جاري التحميل" color="#512477" />}
        {screen === 'search' && <>
          <View style={styles.hero}>
            <Text accessibilityRole="header" style={styles.heroTitle}>وش تبي تأكل اليوم؟</Text>
            <Text style={styles.heroText}>اختر وقتك وميزانيتك وقارن باقات المطاعم في الرياض.</Text>
          </View>
          <Card>
            <Title>ابحث عن باقة</Title>
            <Choices options={meals} value={filters.meal} change={meal => setFilters({ ...filters, meal })} />
            <Choices options={areas} value={filters.area} change={area => setFilters({ ...filters, area })} />
            <Input label="التاريخ الميلادي" placeholder="YYYY-MM-DD" value={filters.day} ltr
              onChangeText={day => setFilters({ ...filters, day })} />
            <Input label="عدد الأشخاص" value={filters.people} keyboardType="number-pad" ltr
              onChangeText={people => setFilters({ ...filters, people })} />
            <Input label="الميزانية القصوى بالريال" value={filters.budget} keyboardType="decimal-pad" ltr
              onChangeText={budget => setFilters({ ...filters, budget })} />
            <Button label="اعرض الباقات" disabled={busy} onPress={() => run(search)} />
          </Card>
          {selected.length >= 2 && <Button label={'قارن الباقات (' + selected.length + ')'} onPress={() => navigate('compare')} />}
          {searched && <Title>{offers.length ? 'الباقات المطابقة' : 'ما لقينا باقات مطابقة'}</Title>}
          {offers.map(item => <OfferCard key={item.id} offer={item}
            selected={selected.some(chosen => chosen.id === item.id)}
            onOpen={() => { setOffer(item); navigate('detail'); }} onCompare={() => toggleCompare(item)} />)}
        </>}
        {screen === 'compare' && <>
          <Title>مقارنة الباقات</Title>
          {selected.map(item => <Card key={item.id}>
            <Title>{item.name}</Title><Text style={styles.price}>{money(item.price_halalas)}</Text>
            <Copy>{item.venue} · {item.district} · حتى {item.people} أشخاص</Copy>
            <Copy>{item.inclusions}</Copy><Copy>{riyadhTime(item.starts_at)} إلى {riyadhTime(item.ends_at)}</Copy>
            <Button label="عرض التفاصيل" onPress={() => { setOffer(item); navigate('detail'); }} />
          </Card>)}
          <Button label="العودة إلى الباقات" secondary onPress={() => navigate('search')} />
        </>}
        {screen === 'detail' && offer && <Card>
          <Title>{offer.name}</Title><Text style={styles.price}>{money(offer.price_halalas)}</Text>
          <Copy>{offer.venue} · {offer.district} · حتى {offer.people} أشخاص</Copy>
          <Copy>{offer.inclusions}</Copy><Copy>{offer.address}</Copy>
          <Copy>{riyadhTime(offer.starts_at)} إلى {riyadhTime(offer.ends_at)}</Copy>
          <Button label="الاتجاهات إلى الفرع" secondary onPress={() => run(() => Linking.openURL(
            'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(offer.latitude + ',' + offer.longitude)))} />
          {activeVoucher ? <>
            <Text selectable style={styles.code}>{voucher.code}</Text>
            <Copy>ينتهي الرمز في {riyadhTime(voucher.expires_at)}</Copy>
          </> : <Button label={token ? 'اطلب رمز الباقة' : 'سجّل الدخول لطلب الرمز'} disabled={busy}
            onPress={() => token ? run(async () => {
              const [issued] = await api('vouchers', { token, method: 'POST', body: { offer: offer.id } });
              setVouchers(current => ({ ...current, [offer.id]: issued }));
            }) : navigate('account')} />}
        </Card>}
        {screen === 'account' && <>
          <Title>حسابي</Title>
          {!token ? <Card>
            <Input label="البريد الإلكتروني" value={credentials.email} keyboardType="email-address" autoCapitalize="none" ltr
              onChangeText={email => setCredentials({ ...credentials, email })} />
            <Input label="كلمة المرور" value={credentials.password} secureTextEntry ltr
              onChangeText={password => setCredentials({ ...credentials, password })} />
            <Button label="دخول" disabled={busy} onPress={() => auth('login')} />
            <Button label="إنشاء حساب" secondary disabled={busy} onPress={() => auth('register')} />
            <Button label="إعادة إرسال تأكيد البريد" secondary disabled={busy} onPress={() => auth('verify')} />
          </Card> : <>
            {!merchant && <Card>
              <Input label="اسم المنشأة" value={merchantName} onChangeText={setMerchantName} />
              <Button label="اطلب حساب تاجر" disabled={busy} onPress={() => run(async () => {
                await api('merchant', { token, method: 'POST', body: { name: merchantName } });
                await refreshMerchant(token);
              })} />
            </Card>}
            {merchant && !merchant.approved && <Card>
              <Copy>طلب «{merchant.name}» بانتظار المراجعة.</Copy>
              <Button label="تحديث حالة الطلب" secondary disabled={busy} onPress={() => run(() => refreshMerchant(token))} />
            </Card>}
            {merchant?.approved ? <Button label="لوحة التاجر" onPress={() => navigate('merchant')} /> : null}
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
    <View style={styles.footer}>
      <Button label="الباقات" secondary={screen !== 'search'} onPress={() => navigate('search')} />
      <Button label="حسابي" secondary={screen !== 'account'} onPress={() => navigate('account')} />
    </View>
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
  footer: { backgroundColor: 'white', flexDirection: 'row-reverse', justifyContent: 'space-evenly', paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#e7dced' },
});
