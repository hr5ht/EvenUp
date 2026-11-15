// Add people to a group: your friends, filtered as you type a name, or anyone by email.
// pickPeople({ friends, taken, chosen, onDone }) opens the popup; onDone gets [{ name, friend_id } | { name, email }].
// An email with an account joins straight away; anyone else gets an invite email (the server decides).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function peopleSheet() {
  let d = document.getElementById("people-sheet");
  if (d) return d;
  d = el("dialog", { className: "sheet", id: "people-sheet" },
    el("form", { className: "sheet-form", id: "people-form" },
      el("div", { className: "grip" }),
      el("div", { className: "sheet-head" }, el("h2", { textContent: "Add people" }),
        el("button", { type: "button", className: "icon-btn sm", ariaLabel: "Close", onclick: () => d.close() }, icon("x"))),
      el("div", { className: "sheet-body" },
        el("input", { className: "field", type: "text", id: "people-q", placeholder: "Search friends or type an email",
          autocomplete: "off", autocapitalize: "off", spellcheck: false, inputMode: "email" }),
        el("div", { className: "list", id: "people-list" })),
      el("div", { className: "sheet-foot" }, el("button", { className: "btn ink", type: "submit", id: "people-add" }))));
  d.addEventListener("click", (ev) => ev.target === d && d.close());
  document.body.append(d);
  return d;
}

function pickPeople({ friends, taken = new Set(), chosen = [], onDone }) {
  const d = peopleSheet(), q = document.getElementById("people-q");
  const picked = new Map(chosen.map((p) => [p.email ? `e:${p.email}` : `f:${p.friend_id}`, p]));
  const free = friends.filter((f) => !taken.has(f.name));

  const row = (key, person, sub, mark) => el("button", {
    type: "button", className: `pick${picked.has(key) ? " current" : ""}`,
    onclick: () => { picked.has(key) ? picked.delete(key) : picked.set(key, person); if (person.email) q.value = ""; render(); q.focus(); },
  }, mark, el("span", { className: "grow" }, person.name, el("span", { textContent: sub })), icon(picked.has(key) ? "check" : "plus"));

  function render() {
    const s = q.value.trim().toLowerCase();
    const rows = [...picked].filter(([k]) => k.startsWith("e:")).map(([k, p]) =>
      row(k, p, "Joins if they're on EvenUp, or gets an invite email", el("span", { className: "avatar" }, icon("mail"))));
    for (const f of free) if (!s || f.name.toLowerCase().includes(s) || f.email.toLowerCase().includes(s))
      rows.push(row(`f:${f.id}`, { name: f.name, friend_id: f.id }, f.email, avatar(f.name)));
    if (EMAIL_RE.test(s) && !picked.has(`e:${s}`) && !free.some((f) => f.email.toLowerCase() === s))
      rows.unshift(row(`e:${s}`, { name: s, email: s }, "Add by email", el("span", { className: "avatar" }, icon("mail"))));
    document.getElementById("people-list").replaceChildren(...(rows.length ? rows : [el("p", { className: "muted small-text pad", textContent:
      s ? `No friend matches "${q.value.trim()}". Type their email to add them.`
        : free.length ? "" : "Type an email to add someone. Your friends show up here." })]));
    const n = picked.size, add = document.getElementById("people-add");
    add.textContent = n ? `Add ${n} ${n === 1 ? "person" : "people"}` : "Add people";
    add.disabled = !n;
  }

  q.value = "";
  q.oninput = render;
  q.onkeydown = (ev) => { // Enter on an email picks it, rather than closing the popup
    const s = q.value.trim().toLowerCase();
    if (ev.key === "Enter" && EMAIL_RE.test(s)) { ev.preventDefault(); picked.set(`e:${s}`, { name: s, email: s }); q.value = ""; render(); }
  };
  document.getElementById("people-form").onsubmit = (ev) => { ev.preventDefault(); d.close(); onDone([...picked.values()]); };
  render();
  d.showModal();
  q.focus();
}
