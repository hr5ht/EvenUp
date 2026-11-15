const $ = (id) => document.getElementById(id);

// What one change says, from the activity log's action and details.
const ICONS = { added: "plus", edited: "receipt", deleted: "x", restored: "history", created: "users", member_added: "userplus", member_removed: "x", upi_set: "wallet",
  member_left: "x", renamed: "receipt", owner_changed: "shield", group_deleted: "x", group_restored: "history" };
function sentence(a) {
  const d = a.details, by = d.by || "Someone", what = d.description ? `${d.description} · ${rupees(d.amount_paise)}` : "";
  return {
    added: [by, " added ", what], edited: [by, " edited ", what], deleted: [by, " deleted ", what], restored: [by, " brought back ", what],
    created: [by, " started the group", ""], member_added: [by, " added ", d.name], member_removed: [by, " removed ", d.name],
    upi_set: [d.name, " added a UPI ID", ""], member_left: [by, " left the group", ""], renamed: [by, " renamed the group to ", d.name],
    owner_changed: [by, " handed the group to ", d.name], group_deleted: [by, " deleted the group", ""], group_restored: [by, " restored the group", ""],
  }[a.action] || [by, ` ${a.action.replace("_", " ")}`, ""];
}

function day(t) {
  const d = new Date(t * 1000), days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
}

(async () => {
  try {
    const [feed, me] = await Promise.all([authed("GET", "/api/me/activity"), authed("GET", "/api/me")]);
    let last = "";
    const rows = [];
    for (const a of feed) {
      const d = day(a.created_at);
      if (d !== last) rows.push(el("p", { className: "day", textContent: (last = d) }));
      const [name, verb, what] = sentence(a);
      const who = name === me.name ? "You" : name;
      rows.push(el("a", { className: "feed-row", href: `/g/${a.slug}` },
        el("span", { className: `feed-ic ${a.action}` }, icon(ICONS[a.action] || "history")),
        el("span", { className: "grow" },
          el("span", { className: "line" }, el("b", { textContent: who }), verb, what ? el("b", { textContent: what }) : null),
          el("span", { className: "where", textContent: `${a.group_name} · ${new Date(a.created_at * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` })),
        icon("chev")));
    }
    $("feed").replaceChildren(...(rows.length ? rows : [el("div", { className: "empty" },
      el("span", { className: "sq-ic" }, icon("history")), el("h3", { textContent: "Nothing here yet" }),
      el("p", { textContent: "When anyone in your groups adds, edits or settles an expense, it shows up here." }),
      el("a", { className: "btn ink small", href: "/#new-group" }, icon("users"), "Start a group"))]));
    $("page").hidden = false;
  } catch (err) {
    if (!needAccount(err)) {
      $("page").hidden = false;
      $("error").textContent = err.message;
    }
  }
})();
