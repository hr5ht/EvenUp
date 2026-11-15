const $ = (id) => document.getElementById(id);

// Home. Signed out: the tabs this browser opened, with who you are in each, so this list is the account.
// Signed in: your account's groups and tabs, the same on every device.

function savedSlugs() {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith("evenup:")).map((k) => k.slice(7));
  } catch {
    return [];
  }
}

const listNames = (names) => (names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", "));
const hoursLeft = (t) => Math.max(0, Math.round((t - Date.now() / 1000) / 3600));

// One group or tab: an icon, the name in serif, a tag and who's in it, and where you stand on the right.
function row({ slug, name, group, ended, hours, people, balance }) {
  const tag = group
    ? el("span", { className: `tag${ended ? "" : " live"}`, textContent: ended ? "deleted" : "group" })
    : el("span", { className: `tag${ended ? "" : " live"}`, textContent: ended ? "closed" : `${hours}h left` });
  const stand = balance == null ? null : el("span", { className: "stand" },
    balance ? el("small", { textContent: balance > 0 ? "You get back" : "You owe" }) : null,
    el("b", { className: balance > 0 ? "pos" : balance < 0 ? "neg" : "settled", textContent: balance ? rupees(Math.abs(balance)) : "Settled" }));
  return el("a", { className: `item${ended ? " closed" : ""}`, href: `/g/${slug}` },
    el("span", { className: "round-ic" }, icon(group ? "users" : "receipt")),
    el("span", { className: "grow" }, el("span", { className: "name", textContent: name }), el("span", { className: "sub" }, tag, el("span", { textContent: people }))),
    stand);
}

function show(rows, empty, box = "list", count = "n-list") {
  $(count).textContent = rows.length || "";
  $(box).replaceChildren(rows.length ? el("div", { className: "list" }, ...rows) : el("div", { className: "empty" },
    el("span", { className: "sq-ic" }, icon("receipt")), el("h3", { textContent: empty[0] }), el("p", { textContent: empty[1] })));
}

// ---------- signed out: this browser's tabs ----------

async function localTabs() {
  const tabs = (await Promise.all(savedSlugs().map((slug) =>
    api("GET", `/api/splits/${encodeURIComponent(slug)}`).then((t) => ({ slug, t })).catch((err) => {
      if (err.status === 404) try { localStorage.removeItem(`evenup:${slug}`); } catch {} // gone for good: forget it too
      return null;
    })))).filter(Boolean);
  return tabs.map(({ slug, t }) => {
    const me = t.members.find((m) => m.id === loadIdentity(slug).me);
    return row({ slug, name: t.name, ended: t.ended, hours: hoursLeft(t.expires_at),
      people: me ? `${me.name}${me.id === t.admin_id ? " · admin" : ""}` : "Pick your name",
      balance: me ? t.balances[me.id] || 0 : null });
  });
}

// ---------- signed in: your account's ----------

// Tabs this browser opened before you signed in join your account first; tabs opened elsewhere teach it who you are.
// ponytail: a tab that can't be added (someone else's account took that name) is retried on every visit
async function accountTabs() {
  let tabs = await authed("GET", "/api/tabs");
  const linked = new Set(tabs.map((t) => t.slug));
  const claims = savedSlugs().filter((slug) => !linked.has(slug) && loadIdentity(slug).me != null).map((slug) => {
    const { me, token } = loadIdentity(slug);
    return authed("POST", `/api/splits/${encodeURIComponent(slug)}/claim`, { member_id: me }, token ? { "X-Member-Token": token } : {});
  });
  if (claims.length) {
    await Promise.allSettled(claims);
    tabs = await authed("GET", "/api/tabs");
  }
  for (const t of tabs) if (loadIdentity(t.slug).me !== t.me) saveIdentity(t.slug, { me: t.me, token: t.token, adminToken: t.admin_token });
  return tabs;
}

let friendList = []; // for New group

// Signed in, Home is just your groups and tabs.
async function loadAccount() {
  $("list-title").textContent = "Tabs";
  const [groups, tabs] = await Promise.all([authed("GET", "/api/groups"), accountTabs()]);
  const g = groups.map((g) => row({ slug: g.slug, name: g.name, group: true, ended: g.ended, people: `${listNames(g.members)} · ${rupees(g.spent)}`, balance: g.balance }));
  const t = tabs.map((t) => row({ slug: t.slug, name: t.name, ended: t.ended, hours: hoursLeft(t.expires_at), people: `${listNames(t.members)} · ${rupees(t.spent)}`, balance: t.balance }));
  const none = !g.length && !t.length;
  $("groups-sec").hidden = !g.length;
  show(g, [], "groups", "n-groups");
  $("list-title").hidden = none;
  show(t, none ? ["Nothing to split yet", "Tap + to open a tab or start a group. They're kept on your account, on every device."]
    : ["No tabs open", "Tap + to open one for a trip or a dinner."]);
  friendList = (await authed("GET", "/api/friends")).friends;
}

// ---------- new group ----------

function openGroupSheet() {
  $("new-sheet").close();
  $("group-error").textContent = "";
  showPeople([]);
  $("group-sheet").showModal();
  $("group-name").focus();
}
$("open-group").onclick = openGroupSheet;

// The people picked so far, as chips you can take off again.
let people = [];
function showPeople(list) {
  people = list;
  $("group-people").replaceChildren(...people.map((p) => el("span", { className: "chip" }, avatar(p.name), p.name,
    el("button", { type: "button", className: "icon-btn", ariaLabel: `Remove ${p.name}`, onclick: () => showPeople(people.filter((x) => x !== p)) }, icon("x")))));
}
$("group-add-people").onclick = () => pickPeople({ friends: friendList, chosen: people, onDone: showPeople });

$("group-form").onsubmit = async (ev) => {
  ev.preventDefault();
  $("group-error").textContent = "";
  $("group-save").disabled = true;
  try {
    const friend_ids = people.filter((p) => p.friend_id).map((p) => p.friend_id);
    const emails = people.filter((p) => p.email).map((p) => p.email);
    const { slug } = await authed("POST", "/api/groups", { name: $("group-name").value.trim(), friend_ids, emails });
    location.href = `/g/${slug}`;
  } catch (err) {
    $("group-error").textContent = err.status === 422 ? "One of those emails doesn't look right." : err.message;
    $("group-save").disabled = false;
  }
};

// ---------- start ----------

(async () => {
  if (signedIn()) {
    $("bar").hidden = false;
    document.querySelector("main").classList.add("with-bar");
    try {
      await loadAccount();
      if (location.hash === "#new-group") {
        history.replaceState(null, "", "/");
        openGroupSheet();
      }
      return;
    } catch (err) {
      if (err.status !== 401) return ($("error").textContent = err.message);
      remember(false); // the session lapsed: this browser's own list, until you sign in again
      $("bar").hidden = $("groups-sec").hidden = true;
      $("list-title").hidden = false;
      document.querySelector("main").classList.remove("with-bar");
    }
  }
  // Signed out, Home is a plain landing page (no bottom bar), with the tabs this browser opened under it.
  $("landing").hidden = false;
  $("list-title").textContent = "Your tabs";
  const rows = await localTabs();
  $("list-sec").hidden = !rows.length;
  show(rows, []);
})();
