import React, { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';

export function voucherCode(value) {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(code) ? code : null;
}

export default function VoucherScanner({ onScan, onClose }) {
  const [permission, request] = useCameraPermissions();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const completed = useRef(false);

  return <Modal visible onRequestClose={onClose} animationType="slide">
    <SafeAreaView style={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>امسح رمز العميل</Text>
      {permission?.granted ? <CameraView style={styles.camera} facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (completed.current) return;
          const code = voucherCode(data);
          if (!code) return setNotice('هذا الرمز لا يطابق صيغة رمز باقات.');
          completed.current = true;
          onScan(code);
        }} /> : <>
        <Text style={styles.copy}>اسمح للكاميرا بقراءة رمز العميل، أو ارجع للإدخال اليدوي.</Text>
        {permission?.canAskAgain && <Pressable accessibilityRole="button" disabled={busy} style={styles.button}
          onPress={async () => {
            setBusy(true);
            try { await request(); }
            catch { setNotice('تعذّر طلب إذن الكاميرا.'); }
            finally { setBusy(false); }
          }}><Text style={styles.buttonText}>اسمح بالكاميرا</Text></Pressable>}
      </>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={styles.copy}>{notice}</Text>}
      <Pressable accessibilityRole="button" style={styles.button} onPress={onClose}>
        <Text style={styles.buttonText}>العودة للإدخال اليدوي</Text>
      </Pressable>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#261637', padding: 18, gap: 14 },
  title: { color: 'white', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  copy: { color: 'white', fontSize: 16, textAlign: 'center' },
  camera: { flex: 1, minHeight: 180 },
  button: { minHeight: 48, justifyContent: 'center', backgroundColor: '#f1e7f8', borderRadius: 12 },
  buttonText: { color: '#3f2258', textAlign: 'center', fontWeight: '800', padding: 12 },
});
