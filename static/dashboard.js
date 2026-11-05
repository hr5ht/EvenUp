const $ = (id) => document.getElementById(id);

// Tabs this browser has opened. They need no account, so they live here, not on the profile.
function savedSlugs() {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith("evenup:")).map((k) => k.slice(7));
  } catch {
    return [];
  }
}

function tabRow(slug, t) {
  const names = t.members.map((m) => m.name);
  const title = names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
  const hours = Math.round((t.expires_at - Date.now() / 1000) / 3600);
  return el("li", {},
    el("div", { className: "who" }, el("strong", { textContent: title }),
      el("span", { className: "muted", textContent: t.ended ? "Closed, read-only" : `${hours}h left` })),
    el("a", { className: "button small", href: `/g/${slug}`, textContent: "Open" }));
}

async function loadTabs() {
  const tabs = await Promise.all(savedSlugs().map((slug) =>
    api("GET", `/api/splits/${encodeURIComponent(slug)}`).then((t) => tabRow(slug, t)).catch(() => null))); // expired ones are gone
  const rows = tabs.filter(Boolean);
  $("tabs").replaceChildren(...(rows.length ? rows : [el("li", { className: "muted", textContent: "No open tabs here yet." })]));
}

(async () => {
  try {
    const [me, people] = await Promise.all([authed("GET", "/api/me"), authed("GET", "/api/friends")]);
    $("hello").textContent = `Hi, ${me.name}`;
    $("email").textContent = me.email;
    $("n-friends").textContent = people.friends.length;
    $("n-requests").textContent = people.requests.length;
    $("upi-prompt").hidden = !!me.upi_id;
    await loadTabs();
    $("page").hidden = false;
  } catch (err) {
    if (!needAccount(err)) {
      $("page").hidden = false;
      $("error").textContent = err.message;
    }
  }
})();
