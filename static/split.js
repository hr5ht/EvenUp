const slug = location.pathname.split("/")[2];
const base = `/api/splits/${slug}`;
const $ = (id) => document.getElementById(id);

let identity = loadIdentity(slug); // {me: member_id, adminToken: only when me is the admin}
let data = null;
let membersKey = "";
let editing = null; // {id, version, paidBy, description} while editing an expense

const member = (id) => data.members.find((m) => m.id === id);
const nameOf = (id) => (member(id) || {}).name || "?";
const label = (id) => (id === identity.me ? "You" : nameOf(id));
const isAdmin = () => !!identity.adminToken && identity.me === data.admin_id;
const splitType = () => document.querySelector("input[name=split]:checked").value;
// Expenses and settle-up payments share one table; payments don't count as spending.
const liveExpenses = () => data.expenses.filter((e) => !e.deleted && e.kind === "expense");
const payMethod = (e) => e.description.split(" · ").pop(); // payments are stored as "A paid B · Cash"
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const UPI_HINT = "That doesn't look like a UPI ID (name@bank).";
const paymentsOf = (id) => data.settlement.filter((p) => p.from === id || p.to === id);

// Roll the big number to its new value. Polling re-renders with the same value, which skips the animation.
function countUp(node, paise) {
  const from = Number(node.dataset.value || 0);
  node.dataset.value = paise;
  if (from === paise || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    node.textContent = rupees(paise);
    return;
  }
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 700);
    node.textContent = rupees(Math.round(from + (paise - from) * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- sheets ----------

function openSheet(id) {
  if (!$(id).open) $(id).showModal();
}
document.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openSheet(b.dataset.open)));
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
// Tapping the dimmed backdrop closes a sheet. Clicks inside land on its children, not the dialog itself.
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (ev) => {
  if (ev.target === d && !d.classList.contains("fullscreen")) d.close();
}));

// In-app stand-in for confirm(): resolves true only when the red button is tapped.
function askConfirm(title, text, okLabel) {
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;
  $("confirm-ok").textContent = okLabel;
  openSheet("confirm-sheet");
  return new Promise((resolve) => {
    $("confirm-ok").onclick = () => {
      resolve(true);
      $("confirm-sheet").close();
    };
    $("confirm-sheet").onclose = () => resolve(false); // Cancel, ✕, Escape or tapping outside
  });
}

let toastTimer;
function toast(text, action, fn) {
  const t = $("toast");
  t.replaceChildren(el("span", { textContent: text }));
  if (action) {
    const b = el("button", { type: "button", className: "link", textContent: action });
    b.onclick = () => { t.hidden = true; fn(); };
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
}

// ---------- load + render ----------

async function load() {
  try {
    data = await api("GET", base);
  } catch (err) {
    $("title").textContent = "Split not found";
    $("load-error").textContent = "Splits are deleted a day after they end, or the link is wrong.";
    $("content").hidden = true;
    $("fab").hidden = true;
    return;
  }
  render();
}

function render() {
  $("title").textContent = data.name;
  document.title = `${data.name} · EvenUp`;
  // Nothing of the split shows until you've said who you are.
  const known = !!member(identity.me);
  $("content").hidden = !known;
  $("fab").hidden = !known;
  $("admin-tile").hidden = !isAdmin();

  // Open 48h from creation, then read-only for a day (the server decides which), then deleted.
  const when = (t) => new Date(t * 1000).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" });
  document.body.classList.toggle("ended", data.ended);
  $("ended-card").hidden = !data.ended;
  $("ended-text").textContent = `It closed ${when(data.expires_at)}, so nothing can be added. Download the summary before ${when(data.deletes_at)}, when it's deleted for good.`;
  const hours = Math.max(0, Math.round((data.expires_at * 1000 - Date.now()) / 3600000));
  $("expiry").textContent = `Open until ${when(data.expires_at)} (${hours}h left), then read-only for a day.`;
  $("expiry").hidden = data.ended;

  renderYou();
  renderHero();
  $("tile-balances").textContent = plural(data.members.length, "person").replace("persons", "people");
  renderBalances();
  renderExpenses();
  renderActivity();
  if (isAdmin()) renderAdminMembers();

  // Only rebuild member inputs when members change, so polling doesn't wipe a half-filled form.
  const key = data.members.map((m) => m.id).join(",");
  if (key !== membersKey) {
    membersKey = key;
    buildMemberInputs();
  }

  // New visitor (or their member was removed): "Who are you?" comes first, full screen.
  if (!known && !$("who-dialog").open) openPicker();
}

function renderHero() {
  const live = liveExpenses();
  const total = live.reduce((a, e) => a + e.amount_paise, 0);
  const me = member(identity.me);
  $("hero-sub").textContent = `${rupees(total)} spent · ${plural(live.length, "expense")}`;
  if (me) {
    const b = data.balances[me.id] || 0;
    $("hero-label").textContent = b > 0 ? "You get back" : b < 0 ? "You owe" : "You're all settled";
    countUp($("hero-amount"), Math.abs(b));
    $("hero-amount").className = `hero-amount ${b > 0 ? "owed" : b < 0 ? "owe" : ""}`;
    $("my-payments").replaceChildren(...paymentsOf(me.id).map(paymentRow));
  } else {
    $("hero-label").textContent = "Total spent";
    countUp($("hero-amount"), total);
    $("hero-amount").className = "hero-amount";
    $("my-payments").replaceChildren();
  }
}

// ---------- who are you ----------
// The admin is one of the members. Picking their name asks for the password; the token goes with that name only.

function setIdentity(next) {
  identity = next;
  saveIdentity(slug, identity);
  render();
}

function renderYou() {
  const me = member(identity.me);
  $("you-text").textContent = me ? `${me.name}${isAdmin() ? " · admin" : ""} ▾` : "Who are you?";
  $("upi-form").hidden = !me || !!me.upi_id;
}

$("upi-form").onsubmit = async (ev) => {
  ev.preventDefault();
  $("upi-error").textContent = "";
  try {
    await api("PUT", `${base}/members/${identity.me}/upi`, { upi_id: $("my-upi").value.trim() });
    await load();
    toast("UPI ID saved");
  } catch (err) {
    $("upi-error").textContent = err.status === 422 ? UPI_HINT : err.message;
  }
};

function showPickerStep(step, title) {
  $("who-title").textContent = title;
  $("who-list").hidden = step !== "list";
  $("join-open").hidden = step !== "list";
  $("join-form").hidden = step !== "join";
  $("pw-form").hidden = step !== "admin";
}

function openPicker() {
  // Same full screen every time; only someone who picked a name before gets a ✕ back to the split.
  $("who-dialog").classList.toggle("gate", !member(identity.me));
  $("who-sub").textContent = `Pick your name to open ${data.name}.`;
  const people = data.members.map((m) => {
    const admin = m.id === data.admin_id;
    const b = el("button", { type: "button", className: m.id === identity.me ? "current" : "" },
      el("span", { textContent: m.name }), admin ? el("span", { className: "badge", textContent: "admin" }) : null);
    b.onclick = () => {
      // An ended split can't be changed, so its admin needs no password just to look.
      if (admin && !isAdmin() && !data.ended) {
        showPickerStep("admin", m.name);
        $("pw-error").textContent = "";
        $("admin-pw").value = "";
        $("admin-pw").focus();
        return;
      }
      // Any other name drops the admin token, so a friend using this phone isn't the admin.
      setIdentity({ me: m.id, adminToken: admin ? identity.adminToken : null });
      $("who-dialog").close();
    };
    return b;
  });
  $("who-list").replaceChildren(...people);
  showPickerStep("list", "Who are you?");
  openSheet("who-dialog");
}

$("pw-form").onsubmit = async (ev) => {
  ev.preventDefault();
  try {
    const { admin_token } = await api("POST", `${base}/admin-login`, { password: $("admin-pw").value });
    setIdentity({ me: data.admin_id, adminToken: admin_token });
    $("who-dialog").close();
    toast("Admin unlocked");
  } catch (err) {
    $("pw-error").textContent = err.message;
  }
};
$("switch").onclick = openPicker;
// Escape on the full-screen picker can't skip it: no name, no split.
$("who-dialog").addEventListener("close", () => { if (!member(identity.me)) openPicker(); });
$("pw-back").onclick = openPicker;
$("join-back").onclick = openPicker;

$("join-open").onclick = () => {
  showPickerStep("join", "Join this split");
  $("join-error").textContent = "";
  $("join-name").focus();
};

$("join-form").onsubmit = async (ev) => {
  ev.preventDefault();
  $("join-error").textContent = "";
  try {
    const { id } = await api("POST", `${base}/members`, {
      name: $("join-name").value.trim(),
      upi_id: $("join-upi").value.trim() || null,
    });
    $("join-form").reset();
    identity = { me: id, adminToken: null };
    saveIdentity(slug, identity);
    await load();
    $("who-dialog").close();
  } catch (err) {
    $("join-error").textContent = err.status === 422 ? UPI_HINT : err.message;
  }
};

async function adminApi(method, url, body) {
  try {
    return await api(method, url, body, { "X-Admin-Token": identity.adminToken });
  } catch (err) {
    if (err.status === 403) {
      setIdentity({ me: identity.me, adminToken: null });
      throw new Error("Admin session ended. Tap your name at the top and enter the password again.");
    }
    throw err;
  }
}

// ---------- settle up ----------

// Same format as upi_link() in main.py. %20 not +, and @ left as is, for picky UPI apps.
const IS_ANDROID = /Android/i.test(navigator.userAgent);
// iPadOS reports itself as a Mac; touch points give it away.
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// Phones and tablets, even in "desktop site" mode (which hides Android/iPhone from the user agent): a touch screen.
const IS_PHONE = IS_ANDROID || IS_IOS || matchMedia("(pointer: coarse)").matches;
// iOS has no "pick a UPI app" chooser like Android, so Pay now opens our own with each app's link.
// PhonePe, Google Pay and Paytm are confirmed on an iPhone. BHIM's scheme isn't documented anywhere; bhim://pay is a guess.
const IOS_APPS = [["PhonePe", "phonepe://pay"], ["Google Pay", "gpay://upi/pay"], ["Paytm", "paytmmp://pay"], ["BHIM", "bhim://pay"]];

function upiLink(to, paise, scheme = "upi://pay") {
  const params = { pa: to.upi_id, pn: to.name, am: plainAmount(paise), cu: "INR", tn: data.name.slice(0, 50) };
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, "@")}`)
    .join("&");
  return `${scheme}?${query}`;
}

// ---------- settle up one payment: cash or UPI, then record it ----------

let paying = null; // the settlement row being paid

function payStep(step) {
  $("pay-choose").hidden = step !== "choose";
  $("pay-cash-step").hidden = step !== "Cash";
  $("pay-upi-step").hidden = step !== "UPI";
  $("pay-foot").hidden = step === "choose";
  $("pay-done").textContent = step === "Cash" ? "Mark as paid" : "I've paid";
  $("pay-done").dataset.method = step;
  // Phones get Pay now (straight into the UPI app); then I've paid is the secondary step.
  const payNow = step === "UPI" && IS_PHONE;
  $("pay-now").hidden = !payNow;
  $("pay-done").classList.toggle("primary", !payNow);
  $("pay-error").textContent = "";
}

function openSettle(p) {
  paying = p;
  const to = member(p.to);
  $("pay-title").textContent = `Pay ${rupees(p.amount_paise)} to ${to.name}`;
  $("pay-upi").disabled = !to.upi_id;
  $("pay-no-upi").hidden = !!to.upi_id;
  $("pay-no-upi").textContent = `${to.name} hasn't added a UPI ID yet, so it's cash for now.`;
  payStep("choose");
  openSheet("pay-sheet");
}

$("pay-cash").onclick = () => {
  $("pay-cash-text").textContent = `Did you pay ${nameOf(paying.to)} ${rupees(paying.amount_paise)} in cash?`;
  payStep("Cash");
};

$("pay-upi").onclick = () => {
  const to = member(paying.to);
  const amount = paying.amount_paise;
  $("pay-qr").src = `${base}/qr?to=${to.id}&amount=${amount}`;
  // Android's upi:// shows the system's app chooser; iOS gets ours (see #pay-now's click below).
  $("pay-now").href = IS_IOS ? "#" : upiLink(to, amount);
  $("app-list").replaceChildren(...IOS_APPS.map(([name, scheme]) => el("a", { href: upiLink(to, amount, scheme), textContent: name })));
  $("pay-upi-hint").textContent = IS_PHONE
    ? "Tap Pay now to open your UPI app, then come back and tap I've paid."
    : "Scan with the UPI app on your phone, then tap I've paid.";
  $("pay-upi-id").textContent = to.upi_id;
  $("pay-copy").onclick = (ev) => copyText(to.upi_id, ev.currentTarget);
  payStep("UPI");
};

$("pay-now").onclick = (ev) => {
  if (!IS_IOS) return;
  ev.preventDefault();
  openSheet("app-sheet");
};
// Picking an app leaves for it; close the chooser so I've paid is waiting on return.
$("app-list").onclick = (ev) => { if (ev.target.closest("a")) setTimeout(() => $("app-sheet").close(), 300); };

$("pay-back").onclick = () => payStep("choose");

$("pay-done").onclick = async (ev) => {
  const p = paying;
  ev.currentTarget.disabled = true;
  try {
    const { id } = await api("POST", `${base}/expenses`, {
      kind: "payment",
      paid_by: p.from,
      amount_paise: p.amount_paise,
      split: "exact",
      shares: { [p.to]: p.amount_paise },
      // Real names so the activity log reads right; the list swaps in "You".
      description: `${nameOf(p.from)} paid ${nameOf(p.to)} · ${ev.currentTarget.dataset.method}`,
    });
    $("pay-sheet").close();
    await load();
    toast(`Paid ${nameOf(p.to)} ${rupees(p.amount_paise)}`, "Undo", () => act(() => {
      const a = data.activity.find((x) => x.expense_id === id);
      return api("POST", `${base}/activity/${a.id}/undo`);
    }));
  } catch (err) {
    $("pay-error").textContent = err.message;
  } finally {
    $("pay-done").disabled = false;
  }
};

function paymentRow(p) {
  const to = member(p.to);
  const actions = el("div", { className: "row" });
  if (p.from === identity.me) {
    const settle = el("button", { type: "button", className: "small primary live-only", textContent: "Settle up" });
    settle.onclick = () => openSettle(p);
    actions.append(settle);
  } else if (p.to === identity.me && !to.upi_id) {
    // You're being paid: nothing to do except make sure they can pay you.
    actions.append(el("span", { className: "muted live-only", textContent: "Add your UPI ID to get paid" }));
  }
  return el("li", { className: "pay-row" },
    el("div", { className: "pay-main" },
      el("span", { className: "grow", textContent: `${label(p.from)} → ${label(p.to)}` }),
      el("strong", { className: "amount", textContent: rupees(p.amount_paise) }),
    ),
    actions,
  );
}

function renderBalances() {
  $("balances").replaceChildren(...data.members.map((m) => {
    const b = data.balances[m.id] || 0;
    const you = m.id === identity.me;
    const text = b > 0 ? `${you ? "get" : "gets"} back ${rupees(b)}` : b < 0 ? `${you ? "owe" : "owes"} ${rupees(-b)}` : "settled";
    const pays = paymentsOf(m.id);
    return el("li", { className: "bal-row" },
      el("div", { className: "bal-main" },
        el("span", { className: "grow", textContent: label(m.id) }),
        el("span", { className: `amount ${b > 0 ? "owed" : b < 0 ? "owe" : ""}`, textContent: text }),
      ),
      pays.length ? el("ul", { className: "bal-detail" }, ...pays.map((p) => el("li", {},
        el("span", { className: "grow", textContent: `${label(p.from)} → ${label(p.to)}` }),
        el("span", { className: "amount", textContent: rupees(p.amount_paise) }),
      ))) : null,
    );
  }));
}

// ---------- expenses ----------

function renderExpenses() {
  const live = data.expenses.filter((e) => !e.deleted);
  if (!live.length) {
    $("expenses").replaceChildren(el("li", { className: "muted empty", textContent: "No expenses yet. Tap + Add expense." }));
    return;
  }
  $("expenses").replaceChildren(...live.map((e) => {
    const mine = e.shares[identity.me];
    const payment = e.kind === "payment";
    const row = el("button", { type: "button", className: "exp-row" },
      el("span", { className: "grow" },
        el("span", { className: "title", textContent: payment ? `${label(e.paid_by)} paid ${label(Number(Object.keys(e.shares)[0]))}` : e.description }),
        el("span", { className: "muted", textContent: payment
          ? `Settled up · ${payMethod(e)}`
          : `${label(e.paid_by)} paid${mine ? ` · your share ${rupees(mine)}` : ""}` }),
      ),
      el("strong", { className: "amount", textContent: rupees(e.amount_paise) }),
    );
    row.onclick = () => openExpense(e);
    return el("li", {}, row);
  }));
}

function openExpense(e) {
  const payment = e.kind === "payment";
  const when = new Date(e.created_at * 1000).toLocaleString();
  $("exp-title").textContent = payment ? "Settle-up" : e.description;
  $("exp-detail").replaceChildren(
    el("p", { className: "hero-amount", textContent: rupees(e.amount_paise) }),
    ...(payment ? [
      el("p", { className: "muted", textContent: `${label(e.paid_by)} paid ${label(Number(Object.keys(e.shares)[0]))} · ${payMethod(e)} · ${when}` }),
    ] : [
      el("p", { className: "muted", textContent: `Paid by ${label(e.paid_by)} · ${when}` }),
      el("h3", { textContent: "Split between" }),
      el("ul", { className: "list" }, ...Object.entries(e.shares).map(([id, s]) => el("li", {},
        el("span", { className: "grow", textContent: label(Number(id)) }),
        el("span", { className: "amount", textContent: rupees(s) }),
      ))),
    ]),
  );
  // A payment is undone by deleting it, not edited.
  $("exp-edit").hidden = payment;
  $("exp-edit").parentElement.classList.toggle("two", !payment);
  $("exp-edit").onclick = () => {
    $("expense-sheet").close();
    startEdit(e);
  };
  $("exp-delete").onclick = async () => {
    $("expense-sheet").close();
    await act(() => api("DELETE", `${base}/expenses/${e.id}`));
    toast(`Deleted ${payment ? "payment" : e.description}`, "Undo", () => act(() => {
      const a = data.activity.find((x) => x.expense_id === e.id);
      return api("POST", `${base}/activity/${a.id}/undo`);
    }));
  };
  openSheet("expense-sheet");
}

function buildMemberInputs() {
  $("equal-box").replaceChildren(...data.members.map((m) =>
    el("label", {}, el("input", { type: "checkbox", value: m.id, checked: true }), el("span", { textContent: m.name }))));
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
  editing = { id: e.id, version: e.version, paidBy: e.paid_by, description: e.description };
  $("form-payer").textContent = `Paid by ${e.paid_by === identity.me ? "you" : nameOf(e.paid_by)}`;
  $("desc").value = e.description;
  $("amount").value = plainAmount(e.amount_paise);
  const ids = Object.keys(e.shares).map(Number);
  const amounts = Object.values(e.shares);
  const isEqual = Math.max(...amounts) - Math.min(...amounts) <= 1;
  document.querySelector(`input[name=split][value=${isEqual ? "equal" : "exact"}]`).checked = true;
  $("equal-box").querySelectorAll("input").forEach((c) => (c.checked = ids.includes(Number(c.value))));
  $("exact-box").querySelectorAll("input").forEach((i) => (i.value = e.shares[i.name] ? plainAmount(e.shares[i.name]) : ""));
  showSplitType();
  $("form-title").textContent = "Edit expense";
  $("save").textContent = "Save changes";
  $("form-error").textContent = "";
  openSheet("form-sheet");
}

function resetForm() {
  editing = null;
  $("expense-form").reset();
  $("form-payer").textContent = "Paid by you";
  $("equal-box").querySelectorAll("input").forEach((c) => (c.checked = true));
  showSplitType();
  $("form-title").textContent = "Add expense";
  $("save").textContent = "Add expense";
  $("form-error").textContent = "";
}

$("fab").onclick = () => {
  resetForm();
  openSheet("form-sheet");
  $("amount").focus();
};

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
    // Left empty: "Expense #N" (counting deleted ones, so numbers don't repeat), or the old name when editing.
    description: $("desc").value.trim() || (editing ? editing.description : `Expense #${data.expenses.filter((x) => x.kind === "expense").length + 1}`),
    amount_paise: amount,
    // New expenses are paid by you; editing keeps whoever paid.
    paid_by: editing ? editing.paidBy : identity.me,
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
    const wasEditing = editing;
    if (editing) await api("PUT", `${base}/expenses/${editing.id}`, { ...body, version: editing.version });
    else await api("POST", `${base}/expenses`, body);
    $("form-sheet").close();
    resetForm();
    await load();
    toast(wasEditing ? "Changes saved" : `Added ${body.description}`);
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

// ---------- activity ----------

const ACTIONS = {
  created: "Split created",
  added: "Added",
  edited: "Edited",
  deleted: "Deleted",
  restored: "Restored",
  member_added: "Member added:",
  member_removed: "Member removed:",
  upi_set: "UPI ID updated for",
};

function renderActivity() {
  const kindOf = (id) => (data.expenses.find((e) => e.id === id) || {}).kind;
  // New expenses are already in the expense list, so the log keeps payments and every other change.
  const shown = data.activity.filter((a) => !(a.action === "added" && kindOf(a.expense_id) === "expense"));
  $("activity").replaceChildren(...shown.map((a) => {
    const d = a.details;
    const what = d.description ? `${d.description} (${rupees(d.amount_paise)})` : d.name || "";
    // A payment's description already says it all: "Neha paid Riya · UPI".
    const title = a.action === "added" ? what : `${ACTIONS[a.action] || a.action} ${what}`;
    let undo = null;
    // Only the latest change to each expense can be undone; the server checks this too.
    if (a.expense_id && data.activity.find((x) => x.expense_id === a.expense_id) === a) {
      undo = el("button", { type: "button", className: "small live-only", textContent: "Undo" });
      undo.onclick = () => act(() => api("POST", `${base}/activity/${a.id}/undo`));
    }
    return el("li", {},
      el("span", { className: "grow" },
        el("div", { textContent: title }),
        el("div", { className: "muted", textContent: new Date(a.created_at * 1000).toLocaleString() }),
      ),
      undo,
    );
  }));
}

// ---------- admin ----------

function renderAdminMembers() {
  $("admin-members").replaceChildren(...data.members.map((m) => {
    const remove = el("button", { type: "button", className: "small", textContent: "Remove" });
    remove.onclick = async () => {
      if (!(await askConfirm(`Remove ${m.name}?`, "They can join again from the link if they need to.", "Remove"))) return;
      $("admin-error").textContent = "";
      try {
        await adminApi("DELETE", `${base}/members/${m.id}`);
        await load();
      } catch (err) {
        $("admin-error").textContent = err.message;
      }
    };
    const editUpi = el("button", { type: "button", className: "small", textContent: "UPI" });
    editUpi.onclick = async () => {
      const value = prompt(`UPI ID for ${m.name} (leave empty to clear)`, m.upi_id || "");
      if (value === null) return;
      $("admin-error").textContent = "";
      try {
        await adminApi("PUT", `${base}/members/${m.id}/upi`, { upi_id: value.trim() || null });
        await load();
      } catch (err) {
        $("admin-error").textContent = err.status === 422 ? UPI_HINT : err.message;
      }
    };
    return el("li", {},
      el("span", { className: "grow" }, el("div", { textContent: m.name }),
        el("div", { className: "muted", textContent: m.upi_id || "no UPI ID" })),
      el("span", { className: "row" }, editUpi, remove),
    );
  }));
}

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
  if (!(await askConfirm("Delete this split?", "It's deleted for everyone, with all its expenses and payments. This can't be undone.", "Delete split"))) return;
  try {
    await adminApi("DELETE", base);
    location.href = "/";
  } catch (err) {
    $("admin-error").textContent = err.message;
  }
};

// ---------- share ----------

$("copy-link").onclick = (ev) => copyText(location.origin + location.pathname, ev.currentTarget);

// Shorten text with … until it fits in maxWidth.
function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text && ctx.measureText(text + "…").width > maxWidth) text = text.slice(0, -1);
  return text + "…";
}

$("download-png").onclick = async (ev) => {
  const button = ev.currentTarget;
  button.disabled = true;
  try {
    // A compact receipt: white and grey on black, the app's one accent only for money coming back.
    // Balances only, plus every recorded payment so anyone can check it.
    const W = 600, PAD = 32;
    const C = { text: "#f5f5f7", muted: "#8e8e93", line: "#333336", accent: "#c6ff3d" };
    const money = (p) => rupees(p).replace(/\.00$/, ""); // ₹650, not ₹650.00
    const expenses = liveExpenses();
    const total = expenses.reduce((a, e) => a + e.amount_paise, 0);
    const payments = data.expenses.filter((e) => !e.deleted && e.kind === "payment").reverse();
    const payee = (e) => Number(Object.keys(e.shares)[0]);
    const people = data.members.map((m) => ({
      name: m.name,
      balance: data.balances[m.id] || 0,
      // Who still pays whom, from both ends: "pays Riya" under Aman, "gets from Aman" under Riya.
      lines: data.settlement.filter((p) => p.from === m.id).map((p) => [`pays ${nameOf(p.to)}`, p.amount_paise])
        .concat(data.settlement.filter((p) => p.to === m.id).map((p) => [`gets from ${nameOf(p.from)}`, p.amount_paise])),
    }));

    // Drawn twice: once to measure the height, once for real.
    const draw = (ctx, H) => {
      const font = (size, weight = 400) => (ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`);
      // Returns the width drawn, so a label can sit just left of a right-aligned amount.
      const text = (str, x, y, color, size, weight = 400, align = "left") => {
        font(size, weight);
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.fillText(str, x, y);
        return ctx.measureText(str).width;
      };
      const rule = () => { y += 20; ctx.fillStyle = C.line; ctx.fillRect(PAD, y, W - 2 * PAD, 1); };
      const heading = (str) => { y += 30; text(str, PAD, y, C.muted, 12, 600); y += 2; };
      const R = W - PAD;

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);

      let y = PAD + 26;
      font(28, 700);
      text(fit(ctx, data.name, W - 2 * PAD), PAD, y, C.text, 28, 700);
      y += 24;
      const date = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      text(`${date} · ${money(total)} spent · ${plural(expenses.length, "expense")} · ${plural(people.length, "person").replace("persons", "people")}`,
        PAD, y, C.muted, 14);
      rule();

      heading("BALANCES");
      for (const p of people) {
        y += 28;
        const b = p.balance;
        let right = b ? text(money(Math.abs(b)), R, y, b > 0 ? C.accent : C.text, 16, 700, "right") : text("settled", R, y, C.muted, 14, 400, "right");
        if (b) right += 6 + text(b > 0 ? "gets back" : "owes", R - right - 6, y, C.muted, 13, 400, "right");
        font(16, 600);
        text(fit(ctx, p.name, W - 2 * PAD - right - 16), PAD, y, C.text, 16, 600);
        // Its payments hang off a thin tree line, like └ in a terminal.
        const stem = y + 6;
        for (const [what, amount] of p.lines) {
          y += 22;
          ctx.fillStyle = C.line;
          ctx.fillRect(PAD + 5, stem, 1, y - 5 - stem);
          ctx.fillRect(PAD + 5, y - 5, 9, 1);
          text(what, PAD + 20, y, C.muted, 13);
          text(money(amount), R, y, C.muted, 13, 400, "right");
        }
      }

      if (payments.length) {
        rule();
        heading("PAYMENTS MADE");
        for (const p of payments) {
          y += 26;
          const amount = text(money(p.amount_paise), R, y, C.text, 15, 600, "right");
          font(15, 600);
          text(fit(ctx, `${nameOf(p.paid_by)} paid ${nameOf(payee(p))}`, W - 2 * PAD - amount - 16), PAD, y, C.text, 15, 600);
          y += 18;
          text(`${payMethod(p)} · ${new Date(p.created_at * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`,
            PAD, y, C.muted, 12);
        }
      }

      rule();
      y += 24;
      text("Split with EvenUp", PAD, y, C.muted, 12);
      return y + PAD - 8;
    };
    const H = draw(el("canvas").getContext("2d"), 0);
    const canvas = el("canvas", { width: W * 2, height: H * 2 }); // 2x, sharp on phones
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    draw(ctx, H);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    await saveFile(blob, "png", "image/png");
  } catch (err) {
    alert(`Couldn't make the image: ${err.message || err}`);
  } finally {
    button.disabled = false;
  }
};

async function saveFile(blob, ext, type) {
  const file = new File([blob], `${data.name.replace(/[^\w -]/g, "").trim() || "split"}.${ext}`, { type });
  // Phones get the share sheet (straight to WhatsApp). Laptops download, even where they could share (macOS).
  if (IS_PHONE && navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: data.name }).catch(() => {});
  } else {
    const a = el("a", { href: URL.createObjectURL(file), download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

// One row per expense and payment with everyone's share, then the final balances.
$("download-csv").onclick = () => {
  // Names come from anyone with the link: quote them, and defuse spreadsheet formulas (=, +, -, @).
  const text = (v) => `"${String(v).replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
  const amount = (p) => (p < 0 ? "-" : "") + plainAmount(Math.abs(p));
  const rows = [["Date", "Type", "Description", "Paid by", "Amount (₹)", ...data.members.map((m) => m.name)].map(text)];
  for (const e of data.expenses.filter((x) => !x.deleted).reverse()) {
    rows.push([
      text(new Date(e.created_at * 1000).toLocaleString("en-IN")), text(e.kind), text(e.description), text(nameOf(e.paid_by)),
      amount(e.amount_paise), ...data.members.map((m) => (e.shares[m.id] ? amount(e.shares[m.id]) : "")),
    ]);
  }
  rows.push([], [text("Balance (+ gets back, - owes)"), "", "", "", "", ...data.members.map((m) => amount(data.balances[m.id] || 0))]);
  // BOM so Excel reads ₹ and non-English names as UTF-8.
  saveFile(new Blob(["﻿" + rows.map((r) => r.join(",")).join("\r\n")], { type: "text/csv" }), "csv", "text/csv");
};

$("ended-png").onclick = $("download-png").onclick;
$("ended-csv").onclick = $("download-csv").onclick;

load();
// ponytail: 15s polling for "live" updates, switch to SSE if it ever feels laggy
setInterval(() => { if (!document.hidden && data) load(); }, 15000);
