const membersBox = document.getElementById("members");

function addMemberRow() {
  const first = !membersBox.children.length;
  const input = el("input", { type: "text", placeholder: first ? "Your name" : "Friend's name", maxLength: 40, required: first, className: "m-name" });
  membersBox.append(el("div", { className: "row" }, input, first ? el("span", { className: "badge", textContent: "Admin" }) : null));
  return input;
}

addMemberRow();
document.getElementById("add-member").onclick = () => addMemberRow().focus();

document.getElementById("create").onsubmit = async (e) => {
  e.preventDefault();
  const error = document.getElementById("error");
  error.textContent = "";
  const members = [...membersBox.children]
    .map((row) => ({ name: row.querySelector(".m-name").value.trim() }))
    .filter((m) => m.name);
  if (!members.length) {
    error.textContent = "Add at least one member.";
    return;
  }
  const button = e.submitter;
  button.disabled = true;
  try {
    const { slug, admin_token, admin_member_id } = await api("POST", "/api/splits", {
      name: document.getElementById("name").value.trim(),
      members,
      admin_password: document.getElementById("admin-password").value,
      website: document.getElementById("website").value,
    });
    // This device is already "you, the admin" when the split opens.
    saveIdentity(slug, { me: admin_member_id, adminToken: admin_token });
    const share = `${location.origin}/g/${slug}`;
    document.getElementById("share-link").textContent = share;
    document.getElementById("copy-share").onclick = (ev) => copyText(share, ev.target);
    document.getElementById("open").href = share;
    document.getElementById("create").hidden = true;
    document.getElementById("created").hidden = false;
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
  }
};
