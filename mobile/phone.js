import { getApp } from '@react-native-firebase/app';
import {
  getAuth, linkWithCredential, PhoneAuthProvider, signInWithCredential,
  signInWithEmailAndPassword, signOut, verifyPhoneNumber,
} from '@react-native-firebase/auth';

export function phoneAuth() {
  try { return getAuth(getApp()); } catch { return null; }
}

export function saudiMobile(input) {
  const digits = '٠١٢٣٤٥٦٧٨٩';
  const value = input.trim().replace(/[٠-٩]/g, digit => digits.indexOf(digit))
    .replace(/[\s()-]/g, '').replace(/^(?:\+966|00966|966|0)/, '');
  if (!/^5\d{8}$/.test(value)) throw new Error('INVALID_PHONE');
  return '+966' + value;
}

export async function requestPhoneCode(auth, number, emailAccount) {
  const phone = saudiMobile(number);
  if (emailAccount) {
    const signed = await signInWithEmailAndPassword(auth, emailAccount.email, emailAccount.password);
    if (signed.user.uid !== emailAccount.uid || !signed.user.emailVerified) {
      await signOut(auth);
      throw new Error('ACCOUNT_MISMATCH');
    }
  } else if (auth.currentUser) {
    await signOut(auth);
  }
  return new Promise((resolve, reject) => {
    verifyPhoneNumber(auth, phone).on('state_changed', snapshot => {
      if (snapshot.verificationId && (snapshot.state === 'sent' || snapshot.state === 'verified' || snapshot.state === 'timeout')) {
        resolve({ id: snapshot.verificationId, phone, linkUid: emailAccount?.uid, automaticCode: snapshot.code });
      } else if (snapshot.state === 'error') {
        reject(snapshot.error || new Error('PHONE_FAILED'));
      }
    }, reject);
  });
}

export async function confirmPhoneCode(auth, challenge, code) {
  if (!/^\d{6}$/.test(code)) throw new Error('INVALID_CODE');
  const credential = PhoneAuthProvider.credential(challenge.id, code);
  if (challenge.linkUid) {
    if (auth.currentUser?.uid !== challenge.linkUid) throw new Error('ACCOUNT_MISMATCH');
    return (await linkWithCredential(auth.currentUser, credential)).user;
  }
  return (await signInWithCredential(auth, credential)).user;
}

export function nativeSession(auth, user) {
  let closed = false;
  return {
    user: { id: user.uid },
    close() {
      closed = true;
      if (auth.currentUser?.uid === user.uid) signOut(auth).catch(() => {});
    },
    async accessToken() {
      if (closed || auth.currentUser?.uid !== user.uid) throw new Error('AUTH_REQUIRED');
      const token = await user.getIdToken();
      if (closed) throw new Error('AUTH_REQUIRED');
      return token;
    },
  };
}
