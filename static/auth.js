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

// For a page that needs an account. An unverified one is signed out, or /login and the page would bounce forever.
async function needAccount(err) {
  if (err.status === 401) location.replace("/login");
  else if (err.status === 403) {
    await api("POST", "/auth/sign-out", {}).catch(() => {});
    location.replace("/login?unverified=1");
  } else return false;
  return true;
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
