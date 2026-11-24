export function createSession(user, apiKey) {
  let idToken = user.idToken;
  let refreshToken = user.refreshToken;
  let expiresAt = Date.now() + Number(user.expiresIn) * 1000;
  let pending;
  let closed = false;

  return {
    user: { id: user.localId },
    close() {
      closed = true;
      idToken = refreshToken = undefined;
    },
    async accessToken() {
      if (closed) throw new Error('AUTH_REQUIRED');
      if (Date.now() < expiresAt - 60000) return idToken;
      if (!pending) {
        pending = (async () => {
          const response = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(apiKey), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken),
          });
          if (closed) throw new Error('AUTH_REQUIRED');
          const data = await response.json();
          if (closed) throw new Error('AUTH_REQUIRED');
          if (!response.ok) {
            const reason = data.error?.message;
            if (['TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN', 'USER_DISABLED', 'USER_NOT_FOUND'].includes(reason)) {
              throw new Error('AUTH_REQUIRED');
            }
            throw new Error('AUTH_UNAVAILABLE');
          }
          if (!data.id_token || !data.refresh_token || data.user_id !== user.localId ||
              !(Number(data.expires_in) > 0)) throw new Error('AUTH_UNAVAILABLE');
          idToken = data.id_token;
          refreshToken = data.refresh_token;
          expiresAt = Date.now() + Number(data.expires_in) * 1000;
          return idToken;
        })().finally(() => { pending = undefined; });
      }
      return pending;
    },
  };
}
