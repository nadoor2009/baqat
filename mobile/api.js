const origin = 'https://baqat.naderalmutairi50.workers.dev';

export async function api(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(origin + '/api/' + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'REQUEST_FAILED');
  return data;
}

export async function authenticate(mode, email, password) {
  const { apiKey } = await api('config');
  if (!apiKey) throw new Error('AUTH_UNCONFIGURED');
  const firebase = async (method, body) => {
    const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:' +
      method + '?key=' + encodeURIComponent(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'AUTH_REQUIRED');
    return result;
  };
  const user = await firebase(mode === 'register' ? 'signUp' : 'signInWithPassword', {
    email, password, returnSecureToken: true,
  });
  if (mode !== 'login') {
    await firebase('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: user.idToken });
    return null;
  }
  return user.idToken;
}

export function errorMessage(error) {
  const messages = {
    INVALID_LOGIN_CREDENTIALS: 'تأكد من البريد الإلكتروني وكلمة المرور.',
    EMAIL_EXISTS: 'هذا البريد مسجل بالفعل. جرّب تسجيل الدخول.',
    EMAIL_UNVERIFIED: 'أكّد بريدك الإلكتروني أولًا. تقدر تعيد إرسال رسالة التأكيد.',
    AUTH_UNCONFIGURED: 'خدمة تسجيل الحسابات غير متاحة الآن.',
    AUTH_REQUIRED: 'سجّل الدخول من جديد للمتابعة.',
    ISSUE_DENIED: 'تعذّر إصدار الرمز. قد تكون الباقة غير متاحة الآن أو عندك رمز ساري لها.',
    OFFER_UNAVAILABLE: 'الباقة غير متاحة.',
    INVALID_INPUT: 'راجع البيانات المدخلة وحاول مرة أخرى.',
    MERCHANT_REQUIRED: 'تحتاج حساب تاجر معتمد لإضافة باقة.',
  };
  return messages[error.message] || 'تعذّر إكمال العملية. حاول مرة أخرى.';
}

export function riyadhDay() {
  return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
}

export function riyadhTime(value) {
  return new Intl.DateTimeFormat('ar-SA', {
    calendar: 'gregory', timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));
}
