import React from 'react';
import { colors, Icon } from './ui';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

export const categories = [
  ['food', 'مطاعم ومقاهٍ'], ['fun', 'ألعاب وترفيه'],
  ['travel', 'سفر وتجارب'], ['stay', 'إقامة وفنادق'], ['sports', 'رياضة'], ['wellness', 'عناية واسترخاء'], ['shopping', 'تسوق'],
  ['events', 'فعاليات'], ['learning', 'تعليم وورش'], ['services', 'خدمات'], ['other', 'أخرى'],
];

export const illustrations = {
  lunch: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=900&auto=format&fit=crop',
  dinner: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=900&auto=format&fit=crop',
  both: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=900&auto=format&fit=crop',
};

export function sampleOffers(day) {
  return [
    ['lunch', 'باقة غداء لشخصين', 'الملقا', 119, 24.798, 46.607, 'طبقان رئيسيان، سلطة، مشروبان'],
    ['both', 'باقة مشاوي متكاملة', 'الياسمين', 169, 24.816, 46.645, 'مشاوي مشكلة، أرز، مقبلات، مشروبان'],
    ['dinner', 'باقة عشاء لشخصين', 'حطين', 149, 24.762, 46.607, 'طبقان رئيسيان، مقبلات، مشروبان'],
    ['both', 'باقة عائلية', 'الصحافة', 199, 24.792, 46.649, 'أربع وجبات، طبق جانبي، أربعة مشروبات'],
    ['both', 'باقة اقتصادية لشخصين', 'القيروان', 89, 24.828, 46.603, 'وجبتان ومشروبان'],
  ].map(([meal, name, district, price, latitude, longitude, inclusions], index) => ({
    id: 'sample-' + index, sample: true, city: 'الرياض', meal, name, district, price_halalas: price * 100,
    latitude, longitude, inclusions, venue: 'مطعم افتراضي', address: district + ' · الرياض',
    people: index === 3 ? 4 : 2,
    starts_at: day + (meal === 'dinner' ? 'T18:00:00' : 'T12:00:00') + '+03:00',
    ends_at: day + (meal === 'lunch' ? 'T16:00:00' : 'T23:00:00') + '+03:00',
  }));
}

export function Photo({ meal, style, uri, category = 'food' }) {
  const [failed, setFailed] = React.useState(null);
  const fallback = illustrations[meal] || illustrations.both;
  if (category !== 'food' && (!uri || failed === uri)) return <View style={[styles.photo, styles.placeholder, style]}>
    <Icon name={['fun', 'travel', 'stay'].includes(category) ? category : 'other'} size={36} />
  </View>;
  return <Image accessible={false} accessibilityIgnoresInvertColors source={{ uri: uri && failed !== uri ? uri : fallback }}
    onError={() => { if (uri) setFailed(uri); }}
    resizeMode="cover" style={[styles.photo, style]} />;
}

export function CategoryGrid({ onSelect }) {
  return <View style={styles.grid}>{categories.map(([id, title]) =>
    <Pressable key={id} accessibilityRole="button" onPress={() => onSelect(id)}
      style={({ pressed }) => [styles.tile, id === 'food' && styles.featured, pressed && styles.pressed]}>
      <Icon name={['food', 'fun', 'travel', 'stay'].includes(id) ? id : 'other'} color={id === 'food' ? colors.onPrimary : colors.primary} />
      <Text style={[styles.title, id === 'food' && styles.featuredText]}>{title}</Text>
    </Pressable>)}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '29%', minHeight: 86, justifyContent: 'center', alignItems: 'center',
    gap: 8, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 12 },
  featured: { backgroundColor: colors.primary, borderColor: colors.primary },
  title: { fontSize: 15, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  featuredText: { color: colors.onPrimary },
  pressed: { opacity: 0.72 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: 146, borderRadius: 12, backgroundColor: colors.soft },
});
