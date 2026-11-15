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
const stand = (b) => (b > 0 ? ["You get back", rupees(b), "pos"] : b < 0 ? ["You owe", rupees(-b), "neg"] : ["", "Settled", "settled"]);
const listNames = (names) => (names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ").replace(/, ([^,]*)$/, " and $1"));

// One group or quick tab as a list row: what it is, who's in it, what was spent and where you stand.
function row({ href, name, kind, tag, people, spent, balance, closed }) {
  const [label, amount, cls] = balance === null ? ["", `${people.length} people`, "settled"] : stand(balance);
  return el("a", { className: `list-row${closed ? " closed" : ""}`, href },
    el("span", { className: `list-ic ${kind}` }, icon(kind === "group" ? "users" : "receipt")),
    el("span", { className: "grow" },
      el("span", { className: "name" }, el("b", { textContent: name }),
        el("span", { className: `tag ${kind}` }, kind === "group" ? el("i", { className: "dot pos" }) : icon("clock"), tag)),
      el("span", { className: "sub", textContent: `${listNames(people)} · ${rupees(spent)} spent` })),
    el("span", { className: "stand" }, label ? el("span", { textContent: label }) : null, el("b", { className: `num ${cls}`, textContent: amount })),
    icon("chev"));
}

async function loadGroups(me) {
  return (await authed("GET", "/api/groups")).map((g) => row({
    href: `/g/${g.slug}`, name: g.name, kind: "group", tag: "Group",
    people: g.members.map((n) => (n === me.name ? "You" : n)), spent: g.spent, balance: g.balance,
  }));
}

async function loadTabs() {
  const tabs = (await Promise.all(savedSlugs().map((slug) =>
    api("GET", `/api/splits/${encodeURIComponent(slug)}`).then((t) => ({ slug, t })).catch(() => null)))).filter(Boolean); // deleted ones are gone
  return tabs.map(({ slug, t }) => {
    const me = loadIdentity(slug).me;
    const hours = Math.max(0, Math.round((t.expires_at - Date.now() / 1000) / 3600));
    return row({
      href: `/g/${slug}`, name: t.name, kind: "quick", closed: t.ended,
      tag: t.ended ? "Quick tab · closed" : `Quick tab · ${hours}h left`,
      people: t.members.map((m) => (m.id === me ? "You" : m.name)),
      spent: t.expenses.filter((e) => !e.deleted && e.kind === "expense").reduce((a, e) => a + e.amount_paise, 0),
      balance: t.members.some((m) => m.id === me) ? t.balances[me] || 0 : null,
    });
  });
}

function renderList(rows) {
  $("n-list").textContent = rows.length || "";
  $("list").replaceChildren(...(rows.length ? rows : [el("div", { className: "empty" },
    el("span", { className: "ic" }, icon("receipt")), el("h3", { textContent: "Nothing to split yet" }),
    el("p", { textContent: "Start a group for people you split with often, or open a quick tab for one trip or dinner." }),
    el("span", { className: "row" },
      el("button", { type: "button", onclick: () => openGroupSheet() }, icon("users"), "New group"),
      el("a", { className: "button primary", href: "/new" }, icon("plus"), "Open a tab")))]));
}

let friendList = []; // for the New group sheet

// ---------- new group ----------

function openGroupSheet() {
  $("new-sheet").close();
  $("group-error").textContent = "";
  $("group-friends").replaceChildren(...friendList.map((f) =>
    el("label", {}, el("input", { type: "checkbox", value: f.id }), el("span", {}, avatar(f.name), f.name))));
  $("group-hint").textContent = friendList.length ? "You can add more people later." : "Add friends first to put them in a group. You can still start it on your own.";
  $("group-sheet").showModal();
  $("group-name").focus();
}

// Group, in the New popup: here it opens the form; from other pages it comes here with #new-group.
document.querySelectorAll("[data-open=group-sheet]").forEach((b) => (b.onclick = (ev) => { ev.preventDefault(); openGroupSheet(); }));

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
    const [groups, tabs, { friends }] = await Promise.all([loadGroups(me), loadTabs(), authed("GET", "/api/friends")]);
    friendList = friends;
    renderList([...groups, ...tabs]);
    $("page").hidden = false;
    if (location.hash === "#new-group") {
      history.replaceState(null, "", location.pathname);
      openGroupSheet();
    }
  } catch (err) {
    if (!needAccount(err)) {
      $("page").hidden = false;
      $("error").textContent = err.message;
    }
  }
})();
