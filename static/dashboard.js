const $ = (id) => document.getElementById(id);

// Tabs this browser has opened. They need no account, so they live here, not on the profile.
function savedSlugs() {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith("evenup:")).map((k) => k.slice(7));
  } catch {
    return [];
  }
}

// Where you stand, as a label, an amount and a colour.
const stand = (b) => (b > 0 ? ["You get back", rupees(b), "pos"] : b < 0 ? ["You owe", rupees(-b), "neg"] : ["You", "All settled", ""]);
const listNames = (names) => names.join(", ").replace(/, ([^,]*)$/, " and $1");

// One tab or group as a receipt card: what it is, who's in it, what was spent and where you stand.
function slip({ href, name, top, hours, people, spent, balance, closed }) {
  const [label, amount, cls] = balance === null ? ["People", String(people.length), ""] : stand(balance);
  const names = people.slice(0, 4);
  return el("a", { className: "slip-link", href },
    el("div", { className: `slip torn${closed ? " closed" : ""}` },
      el("p", { className: "slip-top" }, el("span", { className: `dot${closed ? "" : " pos"}` }), top, el("span", { className: "h", textContent: hours })),
      el("h3", { textContent: name }),
      el("p", { className: "faces" }, ...names.map((n) => avatar(n)),
        el("span", { className: "t", textContent: listNames(names) + (people.length > 4 ? ` +${people.length - 4}` : "") })),
      el("div", { className: "figs" },
        el("div", {}, el("span", { textContent: "Spent" }), el("strong", { className: "num", textContent: rupees(spent) })),
        el("div", {}, el("span", { textContent: label }), el("strong", { className: `num ${cls}`, textContent: amount })))));
}

function newCard(href, title, sub, open) {
  const card = el(href ? "a" : "button", { className: "slip-new", ...(href ? { href } : { type: "button" }) }, icon("plus"), title, el("span", { textContent: sub }));
  if (open) card.onclick = open;
  return card;
}

async function loadGroups(me) {
  const groups = await authed("GET", "/api/groups");
  $("n-groups").textContent = groups.length || "";
  $("groups").replaceChildren(...groups.map((g) => slip({
    href: `/g/${g.slug}`, name: g.name, top: "Group", hours: `${g.members.length} people`,
    people: g.members.map((n) => (n === me.name ? "You" : n)), spent: g.spent, balance: g.balance,
  })), newCard(null, "New group", "For people you split with often", () => openGroupSheet()));
  return groups.map((g) => ({ name: g.name, href: `/g/${g.slug}`, balance: g.balance }));
}

async function loadTabs() {
  const tabs = (await Promise.all(savedSlugs().map((slug) =>
    api("GET", `/api/splits/${encodeURIComponent(slug)}`).then((t) => ({ slug, t })).catch(() => null)))).filter(Boolean); // deleted ones are gone
  $("n-tabs").textContent = tabs.length || "";
  const lines = [];
  $("tabs").replaceChildren(...tabs.map(({ slug, t }) => {
    const me = loadIdentity(slug).me;
    const mine = t.members.some((m) => m.id === me);
    const balance = mine ? t.balances[me] || 0 : null;
    if (mine && !t.ended) lines.push({ name: t.name, href: `/g/${slug}`, balance });
    return slip({
      href: `/g/${slug}`, name: t.name, top: t.ended ? "Closed, read-only" : "Quick tab", closed: t.ended,
      hours: t.ended ? "" : `${Math.max(0, Math.round((t.expires_at - Date.now() / 1000) / 3600))}h left`,
      people: t.members.map((m) => (m.id === me ? "You" : m.name)),
      spent: t.expenses.filter((e) => !e.deleted && e.kind === "expense").reduce((a, e) => a + e.amount_paise, 0), balance,
    });
  }), newCard("/new", "Open a tab", "Share one link, everyone joins"));
  return lines;
}

// The paper statement: one line per group and open tab, and where you stand overall.
function statement(lines) {
  const net = lines.reduce((a, l) => a + l.balance, 0);
  const [label, , cls] = stand(net);
  $("net-label").textContent = net ? `Overall, ${label.toLowerCase()}` : "You're all settled";
  $("net-dot").className = `dot ${cls}`;
  countUp($("net"), Math.abs(net));
  const open = lines.filter((l) => l.balance);
  $("net-sub").textContent = lines.length ? `Across ${lines.length} ${lines.length === 1 ? "group or tab" : "groups and tabs"}` : "Nothing to settle yet";
  $("lines").replaceChildren(...open.map((l) => el("li", {},
    el("a", { href: l.href, textContent: l.name }), el("i"),
    el("span", { className: `num ${l.balance > 0 ? "pos" : "neg"}`, textContent: `${l.balance > 0 ? "+" : "−"}${rupees(Math.abs(l.balance))}` }))));
}

function person(p, ...acts) {
  return el("div", { className: "person" }, avatar(p.name || p.email),
    el("span", { className: "grow" }, el("strong", { textContent: p.name || p.email }), p.name ? el("span", { textContent: p.email }) : null),
    acts.length ? el("span", { className: "acts" }, ...acts) : null);
}

function answer(label, url, cls, child) {
  const b = el("button", { type: "button", className: cls, ariaLabel: label }, child || label);
  b.onclick = async () => {
    b.disabled = true;
    try {
      await authed("POST", url);
      await loadPeople();
    } catch (err) {
      $("error").textContent = err.message;
      b.disabled = false;
    }
  };
  return b;
}

let friendList = [];
async function loadPeople() {
  const { friends, requests } = await authed("GET", "/api/friends");
  friendList = friends;
  $("requests-panel").hidden = !requests.length;
  $("n-requests").textContent = requests.length || "";
  $("requests").replaceChildren(...requests.map((p) => person(p,
    answer(`Decline ${p.name || p.email}`, `/api/friends/${p.id}/decline`, "icon-btn", icon("x")),
    answer("Accept", `/api/friends/${p.id}/accept`, "small primary"))));
  $("n-friends").textContent = friends.length || "";
  $("friends").replaceChildren(...(friends.length
    ? [...friends.slice(0, 5).map((p) => person(p)), el("a", { className: "more", href: "/friends" }, friends.length > 5 ? `See all ${friends.length} friends` : "Manage friends", icon("chev"))]
    : [el("div", { className: "empty" }, el("span", { className: "ic" }, icon("users")), el("h3", { textContent: "No friends yet" }),
      el("p", { textContent: "Add friends by email to start groups with them." }),
      el("a", { className: "button", href: "/friends" }, icon("userplus"), "Add a friend"))]));
}

// ---------- new group ----------

function openGroupSheet() {
  $("group-error").textContent = "";
  $("group-friends").replaceChildren(...friendList.map((f) =>
    el("label", {}, el("input", { type: "checkbox", value: f.id }), el("span", {}, avatar(f.name), f.name))));
  $("group-hint").textContent = friendList.length ? "You can add more people later." : "Add friends first to put them in a group. You can still start it on your own.";
  $("group-sheet").showModal();
  $("group-name").focus();
}

document.querySelectorAll("[data-open=group-sheet]").forEach((b) => (b.onclick = openGroupSheet));
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
$("group-sheet").addEventListener("click", (ev) => ev.target === $("group-sheet") && $("group-sheet").close());

$("group-form").onsubmit = async (ev) => {
  ev.preventDefault();
  $("group-error").textContent = "";
  $("group-save").disabled = true;
  try {
    const friend_ids = [...document.querySelectorAll("#group-friends input:checked")].map((i) => Number(i.value));
    const { slug } = await authed("POST", "/api/groups", { name: $("group-name").value.trim(), friend_ids });
    location.href = `/g/${slug}`;
  } catch (err) {
    $("group-error").textContent = err.message;
    $("group-save").disabled = false;
  }
};

(async () => {
  $("today").textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  try {
    const me = await authed("GET", "/api/me");
    $("upi-prompt").hidden = !!me.upi_id;
    const [groups, tabs] = await Promise.all([loadGroups(me), loadTabs(), loadPeople()]);
    statement([...groups, ...tabs]);
    $("page").hidden = false;
  } catch (err) {
    if (!needAccount(err)) {
      $("page").hidden = false;
      $("error").textContent = err.message;
    }
  }
})();
