const $ = (id) => document.getElementById(id);

// Tabs this browser has opened. They need no account, so they live here, not on the profile.
function savedSlugs() {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith("evenup:")).map((k) => k.slice(7));
  } catch {
    return [];
  }
}

// One tab as a receipt card: status, people, what was spent and where you stand.
function slip(slug, t) {
  const me = loadIdentity(slug).me;
  const mine = t.members.some((m) => m.id === me);
  const others = t.members.filter((m) => m.id !== me).map((m) => m.name);
  const names = mine ? [...others.slice(0, 3), "you"] : others.slice(0, 4);
  const extra = t.members.length - names.length;
  const spent = t.expenses.filter((e) => !e.deleted && e.kind === "expense").reduce((a, e) => a + e.amount_paise, 0);
  const b = mine ? t.balances[me] || 0 : 0;
  const hours = Math.max(0, Math.round((t.expires_at - Date.now() / 1000) / 3600));
  const stand = !mine ? ["People", String(t.members.length), ""]
    : b > 0 ? ["You get back", rupees(b), "pos"] : b < 0 ? ["You owe", rupees(-b), "neg"] : ["You", "All settled", ""];
  return el("a", { className: "slip-link lift", href: `/g/${slug}` },
    el("div", { className: `slip torn${t.ended ? " closed" : ""}` },
      el("p", { className: "slip-top" }, el("span", { className: `dot${t.ended ? "" : " pos"}` }),
        t.ended ? "Closed, read-only" : "Open", el("span", { className: "h", textContent: t.ended ? "" : `${hours}h left` })),
      el("h3", { textContent: t.name }),
      el("p", { className: "faces" }, ...t.members.slice(0, 4).map((m) => avatar(m.name)),
        el("span", { className: "t", textContent: names.join(", ").replace(/, ([^,]*)$/, " and $1") + (extra > 0 ? ` +${extra}` : "") })),
      el("div", { className: "figs" },
        el("div", {}, el("span", { textContent: "Spent" }), el("strong", { className: "num", textContent: rupees(spent) })),
        el("div", {}, el("span", { textContent: stand[0] }), el("strong", { className: `num ${stand[2]}`, textContent: stand[1] })))));
}

async function loadTabs() {
  const tabs = await Promise.all(savedSlugs().map((slug) =>
    api("GET", `/api/splits/${encodeURIComponent(slug)}`).then((t) => slip(slug, t)).catch(() => null))); // deleted ones are gone
  const cards = tabs.filter(Boolean);
  $("n-tabs").textContent = cards.length || "";
  const open = el("a", { className: "slip-new", href: "/new" }, icon("plus"), "Open a tab", el("span", { textContent: "Share one link, everyone joins" }));
  $("tabs").replaceChildren(...(cards.length ? [...cards, open] : [el("div", { className: "empty" },
    el("span", { className: "ic" }, icon("receipt")),
    el("h3", { textContent: "No quick tabs on this device" }),
    el("p", { textContent: "Tabs you open or join in this browser show up here until they're deleted." }),
    el("a", { className: "button primary", href: "/new" }, icon("plus"), "Open a tab"))]));
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

async function loadPeople() {
  const { friends, requests } = await authed("GET", "/api/friends");
  $("requests-panel").hidden = !requests.length;
  $("n-requests").textContent = requests.length || "";
  $("requests").replaceChildren(...requests.map((p) => person(p,
    answer(`Decline ${p.name || p.email}`, `/api/friends/${p.id}/decline`, "icon-btn", icon("x")),
    answer("Accept", `/api/friends/${p.id}/accept`, "small primary"))));
  $("n-friends").textContent = friends.length || "";
  $("friends").replaceChildren(...(friends.length
    ? [...friends.slice(0, 5).map((p) => person(p)), el("a", { className: "more", href: "/friends" }, friends.length > 5 ? `See all ${friends.length} friends` : "Manage friends", icon("chev"))]
    : [el("div", { className: "empty" }, el("span", { className: "ic" }, icon("users")), el("h3", { textContent: "No friends yet" }),
      el("p", { textContent: "Add friends by email. They'll get a request, or see it when they sign up." }),
      el("a", { className: "button", href: "/friends" }, icon("userplus"), "Add a friend"))]));
}

(async () => {
  $("hello").textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  try {
    const me = await authed("GET", "/api/me");
    $("upi-prompt").hidden = !!me.upi_id;
    await Promise.all([loadTabs(), loadPeople()]);
    $("page").hidden = false;
  } catch (err) {
    if (!needAccount(err)) {
      $("page").hidden = false;
      $("error").textContent = err.message;
    }
  }
})();
