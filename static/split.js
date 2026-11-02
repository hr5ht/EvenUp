const slug = location.pathname.split("/")[2];
const base = `/api/splits/${slug}`;
const adminToken = location.hash.startsWith("#admin=") ? location.hash.slice(7) : null;
const $ = (id) => document.getElementById(id);

let data = null;
let membersKey = "";
let editing = null; // {id, version} while editing an expense

const nameOf = (id) => (data.members.find((m) => m.id === id) || {}).name || "?";
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
  $("admin").hidden = !adminToken;

  if (data.expires_at) {
    const hours = Math.max(0, Math.round((data.expires_at * 1000 - Date.now()) / 3600000));
    $("expiry").textContent = `This split is deleted after 48h of inactivity (${hours}h left if nobody opens it). Copy the summary to keep it.`;
    $("expiry").hidden = false;
  }

  renderSettlement();
  renderBalances();
  renderExpenses();
  renderActivity();
  if (adminToken) renderAdminMembers();

  // Only rebuild member inputs when members change, so polling doesn't wipe a half-filled form.
  const key = data.members.map((m) => m.id).join(",");
  if (key !== membersKey) {
    membersKey = key;
    buildMemberInputs();
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
      el("span", { className: "grow", textContent: `${nameOf(p.from)} pays ${to.name}` }),
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
      el("span", { className: "grow", textContent: m.name }),
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
        await api("DELETE", `${base}/members/${m.id}`, null, { "X-Admin-Token": adminToken });
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

$("add-member").onclick = async () => {
  $("admin-error").textContent = "";
  try {
    await api("POST", `${base}/members`, {
      name: $("new-member").value.trim(),
      upi_id: $("new-member-upi").value.trim() || null,
    }, { "X-Admin-Token": adminToken });
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
    await api("DELETE", base, null, { "X-Admin-Token": adminToken });
    location.href = "/";
  } catch (err) {
    $("admin-error").textContent = err.message;
  }
};

load();
// ponytail: 15s polling for "live" updates, switch to SSE if it ever feels laggy
setInterval(() => { if (!document.hidden && data) load(); }, 15000);
