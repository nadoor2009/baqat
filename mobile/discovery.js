import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

export const categories = [
  ['food', 'غداء أو عشاء', '🍽️'], ['fun', 'ألعاب وترفيه', '🎮'],
  ['travel', 'سفر وتجارب', '✈️'], ['stay', 'إقامة وفنادق', '🛏️'], ['other', 'أخرى', '✦'],
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
    id: 'sample-' + index, sample: true, meal, name, district, price_halalas: price * 100,
    latitude, longitude, inclusions, venue: 'مطعم افتراضي', address: district + ' · الرياض',
    people: index === 3 ? 4 : 2,
    starts_at: day + (meal === 'dinner' ? 'T18:00:00' : 'T12:00:00') + '+03:00',
    ends_at: day + (meal === 'lunch' ? 'T16:00:00' : 'T23:00:00') + '+03:00',
  }));
}

export function Photo({ meal, style }) {
  return <Image accessibilityIgnoresInvertColors source={{ uri: illustrations[meal] || illustrations.both }}
    resizeMode="cover" style={[styles.photo, style]} />;
}

export function CategoryGrid({ onSelect }) {
  return <View style={styles.grid}>{categories.map(([id, title, symbol]) =>
    <Pressable key={id} accessibilityRole="button" onPress={() => onSelect(id)}
      style={[styles.tile, id === 'food' && styles.featured]}>
      <Text style={styles.symbol}>{symbol}</Text>
      <Text style={[styles.title, id === 'food' && styles.featuredText]}>{title}</Text>
    </Pressable>)}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '29%', minHeight: 86, justifyContent: 'center', alignItems: 'center',
    gap: 7, borderRadius: 16, backgroundColor: '#ece4f5', padding: 10 },
  featured: { backgroundColor: '#623994' },
  title: { fontSize: 15, fontWeight: '800', color: '#321c4d', textAlign: 'center' },
  featuredText: { color: 'white' },
  symbol: { fontSize: 25 },
  photo: { width: '100%', height: 146, borderRadius: 12, backgroundColor: '#ece1f3' },
});
