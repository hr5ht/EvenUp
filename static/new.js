const $ = (id) => document.getElementById(id);
const MIN = 2, MAX = 50; // same cap as the server
let people = MIN;
const size = () => people;

// One name box per other person, kept in step with the headcount. Typed names survive resizing.
function syncNames() {
  const box = $("members");
  while (box.children.length < size() - 1) {
    box.append(el("input", { type: "text", placeholder: "Name", maxLength: 40, className: "m-name" }));
  }
  while (box.children.length > size() - 1) box.lastChild.remove();
}

function setSize(n) {
  people = Math.min(MAX, Math.max(MIN, n));
  $("size").textContent = people;
  $("size-down").disabled = people === MIN;
  $("size-up").disabled = people === MAX;
  syncNames();
  preview();
}

// The receipt on the right fills in as you go: your name, the headcount as seats, and how people join.
function preview() {
  const name = $("my-name").value.trim();
  $("r-name").textContent = name || "You";
  $("r-size").textContent = people;
  $("r-join").textContent = $("protect").checked ? "Name + password" : "Pick a name";
  const seats = $("r-seats"), shown = Math.min(people, 12);
  if (seats.dataset.n != people) { // rebuild only when the headcount changes, so typing doesn't replay the pop-in
    seats.dataset.n = people;
    seats.replaceChildren(
      el("span", { className: "seat you" }),
      ...Array.from({ length: shown - 1 }, () => el("span", { className: "seat" })),
      ...(people > shown ? [el("span", { className: "seat more", textContent: `+${people - shown}` })] : []),
    );
  }
  seats.firstChild.textContent = name ? initials(name) : "You";
}
$("my-name").oninput = preview;
$("size-down").onclick = () => setSize(people - 1);
$("size-up").onclick = () => setSize(people + 1);
$("add-names").onchange = (e) => { $("names-box").hidden = !e.target.checked; syncNames(); };
function showProtect() {
  const on = $("protect").checked;
  $("protect-box").hidden = !on;
  $("admin-password").required = on;
  $("protect-sub").textContent = on ? "Everyone signs in with their own password" : "Off: anyone can pick any name";
  preview();
}
$("protect").onchange = () => { showProtect(); if ($("protect").checked) $("admin-password").focus(); };
$("my-name").value = new URLSearchParams(location.search).get("name") || ""; // from a /new?name= link
showProtect();
setSize(MIN);

$("create").onsubmit = async (e) => {
  e.preventDefault();
  $("error").textContent = "";
  // You go first: the server makes the first member the admin. Anyone left out joins from the link.
  const others = $("add-names").checked ? [...document.querySelectorAll(".m-name")].map((i) => i.value.trim()).filter(Boolean) : [];
  const protect = $("protect").checked;
  const button = e.submitter;
  button.disabled = true;
  try {
    const { slug, admin_token, admin_id } = await api("POST", "/api/splits", {
      members: [{ name: $("my-name").value.trim() }, ...others.map((name) => ({ name }))],
      size: size(),
      admin_password: protect ? $("admin-password").value : null,
      website: $("website").value,
    });
    // No passwords: this device opens the split as you. Protected: you sign in with your password like everyone.
    if (!protect) saveIdentity(slug, { me: admin_id, adminToken: admin_token });
    const share = `${location.origin}/g/${slug}`;
    $("share-link").textContent = share;
    $("created-note").textContent = protect
      ? "Everyone opens the same link, picks their name and creates a password. Yours asks for the one you just set."
      : "Everyone opens the same link and picks their name.";
    $("copy-share").onclick = (ev) => copyText(share, ev.currentTarget);
    $("open-tab").href = share;
    // The phone's share sheet (WhatsApp, Telegram…). Without one, as on most laptops: WhatsApp Web.
    $("share").onclick = async () => {
      const text = "Add what you paid on EvenUp, we'll settle up with UPI.";
      if (navigator.share) {
        try { await navigator.share({ title: "EvenUp", text, url: share }); } catch { /* closed the sheet */ }
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${share}`)}`, "_blank", "noopener");
      }
    };
    $("create").hidden = true;
    $("created").hidden = false;
    $("slip").classList.add("opened"); // stamp the receipt
  } catch (err) {
    $("error").textContent = err.message;
    button.disabled = false;
  }
};
