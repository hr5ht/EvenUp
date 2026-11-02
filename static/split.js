const slug = location.pathname.split("/")[2];
const base = `/api/splits/${slug}`;
const $ = (id) => document.getElementById(id);

let identity = loadIdentity(slug); // {me: member_id, adminToken}
let data = null;
let membersKey = "";
let editing = null; // {id, version} while editing an expense
let pickerShown = false;

const nameOf = (id) => (data.members.find((m) => m.id === id) || {}).name || "?";
const label = (id) => nameOf(id) + (id === identity.me ? " (you)" : "");
const splitType = () => document.querySelector("input[name=split]:checked").value;

async function load() {
  try {
    data = await api("GET", base);
  } catch (err) {
    $("title").textContent = "Split not found";
    $("load-error").textContent = "It may have expired after 48 hours of inactivity, or the link is wrong.";
    $("content").hidden = true;
    return;
  }
  render();
}

function render() {
  $("title").textContent = data.name;
  document.title = `${data.name} · EvenUp`;
  $("content").hidden = false;
  $("admin").hidden = !identity.adminToken;
  renderYou();

  if (data.expires_at) {
    const hours = Math.max(0, Math.round((data.expires_at * 1000 - Date.now()) / 3600000));
    $("expiry").textContent = `This split is deleted after 48h of inactivity (${hours}h left if nobody opens it). Copy the summary to keep it.`;
    $("expiry").hidden = false;
  }

  renderSettlement();
  renderBalances();
  renderExpenses();
  renderActivity();
  if (identity.adminToken) renderAdminMembers();

  // Only rebuild member inputs when members change, so polling doesn't wipe a half-filled form.
  const key = data.members.map((m) => m.id).join(",");
  if (key !== membersKey) {
    membersKey = key;
    buildMemberInputs();
  }

  // New visitor (or their member was removed): ask who they are, once per page load.
  if (!pickerShown && !data.members.some((m) => m.id === identity.me)) {
    pickerShown = true;
    openPicker();
  }
}

// ---------- who are you ----------

function setIdentity(next) {
  identity = next;
  saveIdentity(slug, identity);
  $("paid-by").value = identity.me || $("paid-by").value;
  render();
}

function renderYou() {
  const me = data.members.find((m) => m.id === identity.me);
  $("you-text").textContent = me
    ? `You're ${me.name}${identity.adminToken ? " · admin" : ""}`
    : "You haven't picked your name.";
  $("switch").textContent = me ? "Switch" : "Pick your name";
}

function openPicker() {
  $("who-list").replaceChildren(...data.members.map((m) => {
    const b = el("button", { type: "button", textContent: m.name + (m.id === data.admin_member_id ? " (admin)" : "") });
    b.onclick = () => choose(m);
    return b;
  }));
  $("who-list").hidden = false;
  $("pw-form").hidden = true;
  $("who-title").textContent = "Who are you?";
  $("demo-hint").hidden = slug !== "demo";
  $("who-dialog").showModal();
}

function choose(m) {
  const isAdmin = m.id === data.admin_member_id;
  if (!isAdmin || (identity.me === m.id && identity.adminToken)) {
    setIdentity({ me: m.id, adminToken: isAdmin ? identity.adminToken : null });
    $("who-dialog").close();
    return;
  }
  $("who-title").textContent = `Hi ${m.name}`;
  $("who-list").hidden = true;
  $("pw-form").hidden = false;
  $("pw-error").textContent = "";
  $("admin-pw").value = "";
  $("admin-pw").focus();
  $("pw-form").onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const { admin_token } = await api("POST", `${base}/admin-login`, { password: $("admin-pw").value });
      setIdentity({ me: m.id, adminToken: admin_token });
      $("who-dialog").close();
    } catch (err) {
      $("pw-error").textContent = err.message;
    }
  };
  $("pw-skip").onclick = () => {
    setIdentity({ me: m.id, adminToken: null });
    $("who-dialog").close();
  };
}
$("switch").onclick = openPicker;
$("pw-back").onclick = openPicker;

async function adminApi(method, url, body) {
  try {
    return await api(method, url, body, { "X-Admin-Token": identity.adminToken });
  } catch (err) {
    if (err.status === 403) {
      setIdentity({ me: identity.me, adminToken: null });
      throw new Error("Admin session ended. Tap Switch, pick your name and enter the password again.");
    }
    throw err;
  }
}

// Same format as upi_link() in main.py. %20 not +, and @ left as is, for picky UPI apps.
function upiLink(to, paise) {
  const params = { pa: to.upi_id, pn: to.name, am: plainAmount(paise), cu: "INR", tn: data.name.slice(0, 50) };
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, "@")}`)
    .join("&");
  return `upi://pay?${query}`;
}

function showQr(from, to, paise) {
  $("qr-img").src = `${base}/qr?to=${to.id}&amount=${paise}`;
  $("qr-caption").textContent = `${nameOf(from)} pays ${to.name} ${rupees(paise)} · ${to.upi_id}`;
  $("qr-dialog").showModal();
}
$("qr-close").onclick = () => $("qr-dialog").close();

function renderSettlement() {
  const list = $("settlement");
  list.replaceChildren();
  if (!data.settlement.length) {
    list.append(el("li", {}, el("span", { className: "grow", textContent: "All square 🎉" })));
    return;
  }
  for (const p of data.settlement) {
    const to = data.members.find((m) => m.id === p.to);
    const actions = el("span", { className: "row" });
    if (to.upi_id) {
      actions.append(el("a", { href: upiLink(to, p.amount_paise) }, el("button", { type: "button", className: "small primary", textContent: "Pay" })));
      const qr = el("button", { type: "button", className: "small", textContent: "QR" });
      qr.onclick = () => showQr(p.from, to, p.amount_paise);
      actions.append(qr);
      const copy = el("button", { type: "button", className: "small", textContent: "Copy UPI" });
      copy.onclick = () => copyText(`${to.upi_id} ${plainAmount(p.amount_paise)}`, copy);
      actions.append(copy);
    }
    list.append(el("li", {},
      el("span", { className: "grow", textContent: `${label(p.from)} pays ${label(to.id)}` }),
      el("span", { className: "amount", textContent: rupees(p.amount_paise) }),
      actions,
    ));
  }
}

function renderBalances() {
  const list = $("balances");
  list.replaceChildren();
  for (const m of data.members) {
    const b = data.balances[m.id] || 0;
    const text = b > 0 ? `gets back ${rupees(b)}` : b < 0 ? `owes ${rupees(-b)}` : "settled";
    list.append(el("li", {},
      el("span", { className: "grow", textContent: label(m.id) }),
      el("span", { className: `amount ${b > 0 ? "owed" : b < 0 ? "owe" : ""}`, textContent: text }),
    ));
  }
}

function renderExpenses() {
  const list = $("expenses");
  list.replaceChildren();
  const live = data.expenses.filter((e) => !e.deleted);
  if (!live.length) list.append(el("li", { className: "muted", textContent: "No expenses yet." }));
  for (const e of live) {
    const edit = el("button", { type: "button", className: "small", textContent: "Edit" });
    edit.onclick = () => startEdit(e);
    const del = el("button", { type: "button", className: "small", textContent: "Delete" });
    del.onclick = () => act(() => api("DELETE", `${base}/expenses/${e.id}`));
    const who = Object.keys(e.shares).map((id) => nameOf(Number(id))).join(", ");
    list.append(el("li", {},
      el("span", { className: "grow" },
        el("div", { textContent: e.description }),
        el("div", { className: "muted", textContent: `${nameOf(e.paid_by)} paid · split with ${who}` }),
      ),
      el("span", { className: "amount", textContent: rupees(e.amount_paise) }),
      el("span", { className: "row" }, edit, del),
    ));
  }
}

const ACTIONS = {
  created: "Split created",
  added: "Added",
  edited: "Edited",
  deleted: "Deleted",
  restored: "Restored",
  member_added: "Member added:",
  member_removed: "Member removed:",
};

function renderAdminMembers() {
  $("admin-members").replaceChildren(...data.members.map((m) => {
    const remove = el("button", { type: "button", className: "small", textContent: "Remove" });
    remove.onclick = async () => {
      if (!confirm(`Remove ${m.name}?`)) return;
      $("admin-error").textContent = "";
      try {
        await adminApi("DELETE", `${base}/members/${m.id}`);
        await load();
      } catch (err) {
        $("admin-error").textContent = err.message;
      }
    };
    return el("li", {},
      el("span", { className: "grow", textContent: m.name }),
      el("span", { className: "muted", textContent: m.upi_id || "no UPI ID" }),
      remove,
    );
  }));
}

function renderActivity() {
  const list = $("activity");
  list.replaceChildren();
  for (const a of data.activity) {
    const d = a.details;
    const what = d.description ? `${d.description} (${rupees(d.amount_paise)})` : d.name || "";
    let undo = null;
    // Only the latest change to each expense can be undone; the server checks this too.
    if (a.expense_id && data.activity.find((x) => x.expense_id === a.expense_id) === a) {
      undo = el("button", { type: "button", className: "small", textContent: "Undo" });
      undo.onclick = () => act(() => api("POST", `${base}/activity/${a.id}/undo`));
    }
    list.append(el("li", {},
      el("span", { className: "grow" },
        el("div", { textContent: `${ACTIONS[a.action] || a.action} ${what}` }),
        el("div", { className: "muted", textContent: new Date(a.created_at * 1000).toLocaleString() }),
      ),
      undo,
    ));
  }
}

function buildMemberInputs() {
  $("paid-by").replaceChildren(...data.members.map((m) => el("option", { value: m.id, textContent: m.name })));
  if (identity.me) $("paid-by").value = identity.me;
  $("equal-box").replaceChildren(...data.members.map((m) =>
    el("label", {}, el("input", { type: "checkbox", value: m.id, checked: true }), m.name)));
  $("exact-box").replaceChildren(...data.members.map((m) =>
    el("div", { className: "exact-row" },
      el("span", { textContent: m.name }),
      el("input", { type: "text", inputMode: "decimal", placeholder: "0", className: "exact", name: String(m.id) }))));
}

function showSplitType() {
  $("equal-box").hidden = splitType() !== "equal";
  $("exact-box").hidden = splitType() !== "exact";
}
document.querySelectorAll("input[name=split]").forEach((r) => (r.onchange = showSplitType));

function startEdit(e) {
  editing = { id: e.id, version: e.version };
  $("desc").value = e.description;
  $("amount").value = plainAmount(e.amount_paise);
  $("paid-by").value = e.paid_by;
  const ids = Object.keys(e.shares).map(Number);
  const amounts = Object.values(e.shares);
  const isEqual = Math.max(...amounts) - Math.min(...amounts) <= 1;
  document.querySelector(`input[name=split][value=${isEqual ? "equal" : "exact"}]`).checked = true;
  $("equal-box").querySelectorAll("input").forEach((c) => (c.checked = ids.includes(Number(c.value))));
  $("exact-box").querySelectorAll("input").forEach((i) => (i.value = e.shares[i.name] ? plainAmount(e.shares[i.name]) : ""));
  showSplitType();
  $("form-title").textContent = "Edit expense";
  $("save").textContent = "Save changes";
  $("cancel-edit").hidden = false;
  $("expense-form").scrollIntoView({ behavior: "smooth" });
}

function resetForm() {
  editing = null;
  $("expense-form").reset();
  if (identity.me) $("paid-by").value = identity.me;
  $("equal-box").querySelectorAll("input").forEach((c) => (c.checked = true));
  showSplitType();
  $("form-title").textContent = "Add expense";
  $("save").textContent = "Add expense";
  $("cancel-edit").hidden = true;
  $("form-error").textContent = "";
}
$("cancel-edit").onclick = resetForm;

$("expense-form").onsubmit = async (ev) => {
  ev.preventDefault();
  const error = $("form-error");
  error.textContent = "";
  const amount = toPaise($("amount").value);
  if (!amount) {
    error.textContent = "Enter a valid amount, like 1200 or 99.50.";
    return;
  }
  const body = {
    description: $("desc").value.trim(),
    amount_paise: amount,
    paid_by: Number($("paid-by").value),
    split: splitType(),
  };
  if (body.split === "equal") {
    body.participants = [...$("equal-box").querySelectorAll("input:checked")].map((c) => Number(c.value));
    if (!body.participants.length) {
      error.textContent = "Pick at least one person.";
      return;
    }
  } else {
    body.shares = {};
    for (const i of $("exact-box").querySelectorAll("input")) {
      if (!i.value.trim()) continue;
      const p = toPaise(i.value);
      if (p === null) {
        error.textContent = "Exact amounts must be numbers.";
        return;
      }
      body.shares[i.name] = p;
    }
    const sum = Object.values(body.shares).reduce((a, b) => a + b, 0);
    if (sum !== amount) {
      error.textContent = `Exact amounts add up to ${rupees(sum)}, not ${rupees(amount)}.`;
      return;
    }
  }
  $("save").disabled = true;
  try {
    if (editing) await api("PUT", `${base}/expenses/${editing.id}`, { ...body, version: editing.version });
    else await api("POST", `${base}/expenses`, body);
    resetForm();
    await load();
  } catch (err) {
    error.textContent = err.message;
  } finally {
    $("save").disabled = false;
  }
};

async function act(fn) {
  try {
    await fn();
  } catch (err) {
    alert(err.message);
  }
  await load();
}

$("copy-summary").onclick = (ev) => {
  const lines = [`${data.name}`, ""];
  for (const e of data.expenses.filter((x) => !x.deleted)) {
    lines.push(`• ${e.description}: ${rupees(e.amount_paise)} (paid by ${nameOf(e.paid_by)})`);
  }
  lines.push("", "Settle up:");
  if (!data.settlement.length) lines.push("All square 🎉");
  for (const p of data.settlement) {
    const to = data.members.find((m) => m.id === p.to);
    lines.push(`${nameOf(p.from)} → ${to.name}: ${rupees(p.amount_paise)}${to.upi_id ? ` (UPI: ${to.upi_id})` : ""}`);
  }
  lines.push("", location.origin + location.pathname);
  copyText(lines.join("\n"), ev.target);
};

$("print-pdf").onclick = () => window.print(); // browser's "Save as PDF"

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Shorten text with … until it fits in maxWidth.
function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text && ctx.measureText(text + "…").width > maxWidth) text = text.slice(0, -1);
  return text + "…";
}

$("download-png").onclick = async (ev) => {
  const button = ev.target;
  button.disabled = true;
  try {
    const W = 800, PAD = 40, ROW = 44, QR = 160;
    const expenses = data.expenses.filter((e) => !e.deleted);
    const pays = await Promise.all(data.settlement.map(async (p) => {
      const to = data.members.find((m) => m.id === p.to);
      const qr = to.upi_id ? await loadImage(`${base}/qr?to=${to.id}&amount=${p.amount_paise}`) : null;
      return { ...p, to, qr };
    }));
    const H = 120 + 60 + Math.max(1, expenses.length) * ROW + 60
      + Math.max(1, pays.length) * ROW + pays.filter((p) => p.qr).length * (QR + 16) + 70;

    const canvas = el("canvas", { width: W, height: H });
    const ctx = canvas.getContext("2d");
    const font = (size, weight = 400) => (ctx.font = `${weight} ${size}px system-ui, -apple-system, sans-serif`);
    const right = (text, y) => { ctx.textAlign = "right"; ctx.fillText(text, W - PAD, y); ctx.textAlign = "left"; };
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);

    let y = PAD + 32;
    ctx.fillStyle = "#1a1d21";
    font(32, 700);
    ctx.fillText(fit(ctx, data.name, W - 2 * PAD), PAD, y);
    y += 32;
    ctx.fillStyle = "#6b7280";
    font(16);
    const total = expenses.reduce((a, e) => a + e.amount_paise, 0);
    ctx.fillText(`${new Date().toLocaleDateString("en-IN")} · Total ${rupees(total)}`, PAD, y);

    const section = (title) => {
      y += 56;
      ctx.fillStyle = "#0f766e";
      font(20, 700);
      ctx.fillText(title, PAD, y);
      y += 8;
    };

    section("Expenses");
    if (!expenses.length) { y += ROW; ctx.fillStyle = "#6b7280"; font(18); ctx.fillText("No expenses", PAD, y); }
    for (const e of expenses) {
      y += ROW;
      ctx.fillStyle = "#1a1d21";
      font(18);
      ctx.fillText(fit(ctx, `${e.description} · paid by ${nameOf(e.paid_by)}`, W - 2 * PAD - 160), PAD, y);
      right(rupees(e.amount_paise), y);
    }

    section("Settle up");
    if (!pays.length) { y += ROW; ctx.fillStyle = "#1a1d21"; font(18); ctx.fillText("All square 🎉", PAD, y); }
    for (const p of pays) {
      y += ROW;
      ctx.fillStyle = "#1a1d21";
      font(18, 600);
      ctx.fillText(fit(ctx, `${nameOf(p.from)} pays ${p.to.name}`, W - 2 * PAD - 160), PAD, y);
      right(rupees(p.amount_paise), y);
      if (p.qr) {
        ctx.drawImage(p.qr, PAD, y + 12, QR, QR);
        ctx.fillStyle = "#6b7280";
        font(16);
        ctx.fillText(`Scan to pay ${p.to.upi_id}`, PAD + QR + 16, y + 12 + QR / 2);
        y += QR + 16;
      }
    }

    ctx.fillStyle = "#9aa0a6";
    font(14);
    ctx.fillText("Split with EvenUp", PAD, H - PAD + 10);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], `${data.name.replace(/[^\w -]/g, "").trim() || "split"}.png`, { type: "image/png" });
    // Phones get the share sheet (straight to WhatsApp); desktops get a download.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: data.name }).catch(() => {});
    } else {
      const a = el("a", { href: URL.createObjectURL(file), download: file.name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  } catch (err) {
    alert(`Couldn't make the image: ${err.message || err}`);
  } finally {
    button.disabled = false;
  }
};

$("add-member").onclick = async () => {
  $("admin-error").textContent = "";
  try {
    await adminApi("POST", `${base}/members`, {
      name: $("new-member").value.trim(),
      upi_id: $("new-member-upi").value.trim() || null,
    });
    $("new-member").value = "";
    $("new-member-upi").value = "";
    await load();
  } catch (err) {
    $("admin-error").textContent = err.message;
  }
};

$("delete-split").onclick = async () => {
  if (!confirm("Delete this split for everyone? This can't be undone.")) return;
  try {
    await adminApi("DELETE", base);
    location.href = "/";
  } catch (err) {
    $("admin-error").textContent = err.message;
  }
};

load();
// ponytail: 15s polling for "live" updates, switch to SSE if it ever feels laggy
setInterval(() => { if (!document.hidden && data) load(); }, 15000);
