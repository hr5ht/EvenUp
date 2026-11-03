const $ = (id) => document.getElementById(id);
const size = () => Math.min(50, Math.max(2, Math.floor(Number($("size").value)) || 2));

// One name box per other person, kept in step with the headcount. Typed names survive resizing.
function syncNames() {
  const box = $("members");
  while (box.children.length < size() - 1) {
    box.append(el("div", { className: "row" },
      el("input", { type: "text", placeholder: "Name", maxLength: 40, className: "m-name" })));
  }
  while (box.children.length > size() - 1) box.lastChild.remove();
}

$("size-down").onclick = () => { $("size").value = size() - 1; syncNames(); };
$("size-up").onclick = () => { $("size").value = size() + 1; syncNames(); };
$("size").oninput = syncNames;
$("add-names").onchange = (e) => { $("names-box").hidden = !e.target.checked; syncNames(); };
$("protect").onchange = (e) => { $("protect-note").hidden = !e.target.checked; };
syncNames();

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
      admin_password: $("admin-password").value,
      protected: protect,
      website: $("website").value,
    });
    // This device opens the split as you, the admin. In a protected split the same token is your member session.
    saveIdentity(slug, { me: admin_id, adminToken: admin_token, token: protect ? admin_token : null });
    const share = `${location.origin}/g/${slug}`;
    $("share-link").textContent = share;
    $("created-note").textContent = protect
      ? "Everyone opens the same link, picks their name and creates a password."
      : "Everyone opens the same link and picks their name. Yours asks for the admin password.";
    $("copy-share").onclick = (ev) => copyText(share, ev.target);
    $("open").href = share;
    $("create").hidden = true;
    $("created").hidden = false;
  } catch (err) {
    $("error").textContent = err.message;
    button.disabled = false;
  }
};
