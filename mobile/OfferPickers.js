import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import MapView, { Marker } from 'react-native-maps';
import { colors } from './ui';
import { riyadhTime } from './api';

const zone = 'Asia/Riyadh';
const calendarDate = new Intl.DateTimeFormat('ar-SA', { calendar: 'gregory', dateStyle: 'full', timeZone: zone });
const center = { latitude: 24.76, longitude: 46.68 };

function Action({ children, onPress, primary = false, disabled = false }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }}
    style={({ pressed }) => [styles.action, primary && styles.primary, pressed && styles.pressed, disabled && styles.disabled]} onPress={onPress}>
    <Text style={[styles.text, primary && styles.white]}>{children}</Text>
  </Pressable>;
}

export function OfferDate({ label, value, suggested, onChange, dateOnly = false }) {
  const [selection, setSelection] = useState(null);
  const open = () => {
    const initial = new Date(value || suggested || Date.now());
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: initial, mode: 'date', timeZoneName: zone,
        onValueChange: (_, day) => {
          if (dateOnly) { onChange(day.toISOString()); return; }
          DateTimePickerAndroid.open({
            value: day, mode: 'time', is24Hour: true, timeZoneName: zone,
            onValueChange: (_, time) => onChange(time.toISOString()),
          });
        },
      });
      return;
    }
    setSelection(initial);
  };
  return <View style={styles.field}>
    <Text style={styles.text}>{label}</Text>
    <Action onPress={open}>{value ? (dateOnly ? calendarDate.format(new Date(value)) : riyadhTime(value)) : 'اختر التاريخ والوقت'}</Action>
    {selection && <Modal animationType="slide" onRequestClose={() => setSelection(null)}>
      <SafeAreaView style={styles.page}>
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.text}>بتوقيت الرياض</Text>
        <DateTimePicker mode={dateOnly ? 'date' : 'datetime'} display="spinner" themeVariant="light" value={selection}
          timeZoneName={zone} onValueChange={(_, date) => setSelection(date)} />
        <Action primary onPress={() => { onChange(selection.toISOString()); setSelection(null); }}>تأكيد الموعد</Action>
        <Action onPress={() => setSelection(null)}>إلغاء</Action>
      </SafeAreaView>
    </Modal>}
  </View>;
}

export function OfferLocation({ location, onChange }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState(null);
  const valid = pin && pin.latitude >= 16.3 && pin.latitude <= 32.2 &&
    pin.longitude >= 34.4 && pin.longitude <= 56.0;
  return <View style={styles.field}>
    <Action onPress={() => { setPin(location); setOpen(true); }}>
      {location ? 'تعديل موقع الفرع على الخريطة' : 'حدد موقع الفرع على الخريطة'}
    </Action>
    {location && <Text style={styles.text}>تم تحديد موقع الفرع</Text>}
    {open && <Modal animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={styles.page}>
        <Text style={styles.title}>موقع الفرع</Text>
        <Text style={styles.text}>{pin && !valid ? 'اختر موقعًا داخل النطاق المدعوم في السعودية.' : 'حرّك الخريطة وكبّرها، ثم اضغط على مكان الفرع.'}</Text>
        <MapView style={styles.map} initialRegion={{ ...(location || center), latitudeDelta: location ? 0.12 : 13, longitudeDelta: location ? 0.12 : 13 }}
          onPress={event => setPin(event.nativeEvent.coordinate)}>
          {pin && <Marker coordinate={pin} title="موقع الفرع" />}
        </MapView>
        <Action primary disabled={!valid} onPress={() => { onChange(pin); setOpen(false); }}>اعتماد الموقع</Action>
        <Action onPress={() => setOpen(false)}>إلغاء</Action>
      </SafeAreaView>
    </Modal>}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 12, backgroundColor: colors.background },
  field: { gap: 6 },
  map: { flex: 1, borderRadius: 14 },
  title: { color: colors.ink, fontWeight: '800', fontSize: 24, textAlign: 'right' },
  text: { color: colors.muted, fontSize: 16, textAlign: 'right' },
  action: { backgroundColor: colors.soft, borderRadius: 12, padding: 12, minHeight: 48, justifyContent: 'center' },
  primary: { backgroundColor: colors.primary },
  white: { color: 'white', fontWeight: '700', textAlign: 'center' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});
