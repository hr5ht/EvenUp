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
    let msg = data.detail;
    if (Array.isArray(msg)) msg = msg.map((d) => d.msg).join(", ");
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data;
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
