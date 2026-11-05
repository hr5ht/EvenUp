// Neon Auth keeps the session in a cookie on /auth. Our own API takes a short-lived token made from it.
const TOKEN_MS = 10 * 60 * 1000; // Neon's last 15 minutes
let token = null, tokenAt = 0;

async function authToken(fresh) {
  if (!fresh && token && Date.now() - tokenAt < TOKEN_MS) return token;
  const data = await api("GET", "/auth/token").catch(() => ({}));
  token = data.token || null;
  tokenAt = Date.now();
  return token;
}

// api() as the signed-in user. A token can go stale in the gap before it expires, so a 401 gets one fresh try.
async function authed(method, url, body) {
  const send = async (fresh) => api(method, url, body, { Authorization: `Bearer ${await authToken(fresh)}` });
  try {
    return await send(false);
  } catch (err) {
    if (err.status !== 401) throw err;
    return send(true);
  }
}
