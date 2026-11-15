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

// One group or tab as a list row: what it is, who's in it, what was spent and where you stand.
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

// mine: your profile, still on its way; only your name is needed, to say "You".
async function loadGroups(mine) {
  const groups = await authed("GET", "/api/groups");
  const me = await mine;
  return groups.map((g) => row({
    href: `/g/${g.slug}`, name: g.name, kind: "group", tag: g.ended ? "Group · deleted" : "Group", closed: g.ended,
    people: g.members.map((n) => (n === me.name ? "You" : n)), spent: g.spent, balance: g.balance,
  }));
}

// Your tabs live on your account. Ones this browser opened before you signed in are added to it first.
// ponytail: a tab that can't be added (someone else's account took that name) is retried on every visit
async function loadTabs(mine) {
  let tabs = await authed("GET", "/api/tabs");
  const linked = new Set(tabs.map((t) => t.slug));
  const claims = savedSlugs().filter((slug) => !linked.has(slug) && loadIdentity(slug).me != null).map((slug) => {
    const { me: id, token } = loadIdentity(slug);
    return authed("POST", `/api/splits/${encodeURIComponent(slug)}/claim`, { member_id: id }, token ? { "X-Member-Token": token } : {});
  });
  if (claims.length) {
    await Promise.allSettled(claims);
    tabs = await authed("GET", "/api/tabs");
  }
  const me = await mine;
  return tabs.map((t) => {
    // Opened on another device: this one learns who you are in it, so the tab opens as you.
    if (loadIdentity(t.slug).me !== t.me) saveIdentity(t.slug, { me: t.me, token: t.token, adminToken: t.admin_token });
    const hours = Math.max(0, Math.round((t.expires_at - Date.now() / 1000) / 3600));
    return row({
      href: `/g/${t.slug}`, name: t.name, kind: "quick", closed: t.ended,
      tag: t.ended ? "Tab · closed" : `Tab · ${hours}h left`,
      people: t.members.map((n) => (n === me.name ? "You" : n)), spent: t.spent, balance: t.balance,
    });
  });
}

function renderList(rows) {
  $("n-list").textContent = rows.length || "";
  $("list").replaceChildren(...(rows.length ? rows : [el("div", { className: "empty" },
    el("span", { className: "ic" }, icon("receipt")), el("h3", { textContent: "Nothing to split yet" }),
    el("p", { textContent: "Start a group for people you split with often, or open a tab for one trip or dinner." }),
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
  $("group-hint").textContent = "Anyone not on EvenUp yet gets an invite, and joins when they say yes. You can add more people later.";
  $("group-sheet").showModal();
  $("group-name").focus();
}

// A tab that isn't on your account yet: its link opens it, and opening it signed in adds it.
$("link-open").onsubmit = (ev) => {
  ev.preventDefault();
  const slug = $("link").value.trim().split("/g/").pop().split(/[?#/\s]/)[0];
  if (slug) location.href = `/g/${encodeURIComponent(slug)}`;
};

// Group, in the New popup: here it opens the form; from other pages it comes here with #new-group.
document.querySelectorAll("[data-open=group-sheet]").forEach((b) => (b.onclick = (ev) => { ev.preventDefault(); openGroupSheet(); }));

$("group-form").onsubmit = async (ev) => {
  ev.preventDefault();
  $("group-error").textContent = "";
  $("group-save").disabled = true;
  try {
    const friend_ids = [...document.querySelectorAll("#group-friends input:checked")].map((i) => Number(i.value));
    const emails = $("group-emails").value.split(/[\s,;]+/).filter(Boolean);
    const { slug } = await authed("POST", "/api/groups", { name: $("group-name").value.trim(), friend_ids, emails });
    location.href = `/g/${slug}`;
  } catch (err) {
    $("group-error").textContent = err.status === 422 ? "One of those emails doesn't look right." : err.message;
    $("group-save").disabled = false;
  }
};

(async () => {
  $("today").textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  $("page").hidden = false; // the page is there at once; the list fills in when it arrives
  $("list").replaceChildren(el("p", { className: "muted", textContent: "Loading…" }));
  try {
    // All at once: your profile, groups and tabs ask together (and share one sign-in token).
    const mine = authed("GET", "/api/me");
    const [me, groups, tabs] = await Promise.all([mine, loadGroups(mine), loadTabs(mine)]);
    $("upi-prompt").hidden = !!me.upi_id;
    renderList([...groups, ...tabs]);
    if (location.hash === "#new-group") {
      history.replaceState(null, "", location.pathname);
      openGroupSheet();
    }
    friendList = (await authed("GET", "/api/friends")).friends; // only the New group sheet needs them
  } catch (err) {
    if (!needAccount(err)) $("error").textContent = err.message;
  }
})();
