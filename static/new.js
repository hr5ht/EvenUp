const $ = (id) => document.getElementById(id);
const MIN = 2, MAX = 50; // same cap as the server
let people = MIN;
const size = () => people;

// One name box per other person, kept in step with the headcount. Typed names survive resizing.
function syncNames() {
  const box = $("members");
  while (box.children.length < size() - 1) {
    box.append(el("div", { className: "row" },
      el("input", { type: "text", placeholder: "Name", maxLength: 40, className: "m-name" })));
  }
  while (box.children.length > size() - 1) box.lastChild.remove();
}

function setSize(n) {
  people = Math.min(MAX, Math.max(MIN, n));
  $("size").textContent = people;
  $("size-down").disabled = people === MIN;
  $("size-up").disabled = people === MAX;
  syncNames();
}
$("size-down").onclick = () => setSize(people - 1);
$("size-up").onclick = () => setSize(people + 1);
$("add-names").onchange = (e) => { $("names-box").hidden = !e.target.checked; syncNames(); };
function showProtect() {
  const on = $("protect").checked;
  $("protect-box").hidden = !on;
  $("admin-password").required = on;
  $("protect-sub").textContent = on ? "Everyone signs in with their own password" : "Off: anyone can pick any name";
}
$("protect").onchange = () => { showProtect(); if ($("protect").checked) $("admin-password").focus(); };
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
    $("copy-share").onclick = (ev) => copyText(share, ev.target);
    $("open").href = share;
    $("create").hidden = true;
    $("created").hidden = false;
  } catch (err) {
    $("error").textContent = err.message;
    button.disabled = false;
  }
};
