const membersBox = document.getElementById("members");

function addMemberRow() {
  const input = el("input", { type: "text", placeholder: "Name", maxLength: 40, className: "m-name" });
  membersBox.append(el("div", { className: "row" }, input));
  return input;
}

addMemberRow();
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
    const { slug, admin_token } = await api("POST", "/api/splits", {
      name: document.getElementById("name").value.trim(),
      members,
      admin_password: document.getElementById("admin-password").value,
      website: document.getElementById("website").value,
    });
    // This device is already the admin when the split opens; it still picks a name there.
    saveIdentity(slug, { adminToken: admin_token });
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
