// Shared helpers. Money is integer paise everywhere.

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props || {});
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function rupees(paise) {
  const sign = paise < 0 ? "-" : "";
  const p = Math.abs(paise);
  return `${sign}₹${Math.floor(p / 100).toLocaleString("en-IN")}.${String(p % 100).padStart(2, "0")}`;
}

// "12.5" -> 1250. Returns null for anything that isn't a plain amount.
function toPaise(str) {
  const s = String(str).trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) return null;
  const [r, f = ""] = s.split(".");
  return Number(r) * 100 + Number(f.padEnd(2, "0"));
}

// 1250 -> "12.50", for inputs and UPI links.
function plainAmount(paise) {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

async function api(method, url, body, headers) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data.detail || data.message; // message: from Neon Auth, through /auth
    if (Array.isArray(msg)) msg = msg.map((d) => d.msg).join(", ");
    throw Object.assign(new Error(msg || `Request failed (${res.status})`), { status: res.status });
  }
  return data;
}

// Who this device is in a split: {me: member_id, adminToken}. Lives in localStorage only.
function loadIdentity(slug) {
  try {
    return JSON.parse(localStorage.getItem(`evenup:${slug}`)) || {};
  } catch {
    return {};
  }
}

function saveIdentity(slug, identity) {
  try {
    localStorage.setItem(`evenup:${slug}`, JSON.stringify(identity));
  } catch {
    // Private mode etc.: works for this visit, forgotten afterwards.
  }
}

// Only for choosing Sign in or Dashboard on the landing page. The session itself is an HttpOnly cookie.
function signedIn() {
  try {
    return !!localStorage.getItem("quicktab:signed-in");
  } catch {
    return false;
  }
}

function remember(on) {
  try {
    if (on) localStorage.setItem("quicktab:signed-in", "1");
    else localStorage.removeItem("quicktab:signed-in");
  } catch {
    // Private mode etc.: the landing page just says Sign in.
  }
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const old = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = old), 1500);
  } catch {
    prompt("Copy this:", text);
  }
}

// Rolls a number up to its new value (paise by default) instead of jumping. Still under reduced motion.
function countUp(node, value, fmt = rupees, ms = 700) {
  const from = Number(node.dataset.value || 0);
  node.dataset.value = value;
  // Big figures show paise smaller: ₹2,550<small>.00</small>.
  const paint = (v) => {
    const [whole, paise] = fmt(v).split(".");
    if (paise === undefined || !node.dataset.paise) node.textContent = fmt(v);
    else node.replaceChildren(whole, el("small", { textContent: `.${paise}` }));
  };
  if (from === value || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    paint(value);
    return;
  }
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / ms);
    paint(Math.round(from + (value - from) * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// A line icon from the sprite: icon("check").
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `/static/icons.svg#${name}`);
  svg.setAttribute("class", "i");
  svg.setAttribute("aria-hidden", "true");
  svg.append(use);
  return svg;
}

// "Riya" -> "Ri", "Riya Sen" -> "RS": two letters, so Aman and Arjun don't share an "A".
function initials(name) {
  const words = String(name).trim().split(/\s+/);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0].charAt(0).toUpperCase() + words[0].charAt(1).toLowerCase();
}

function avatar(name) {
  return el("span", { className: "avatar", textContent: initials(name || "?"), ariaHidden: "true" });
}
