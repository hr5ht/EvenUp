const membersBox = document.getElementById("members");

function addMemberRow() {
  const first = !membersBox.children.length;
  const row = el("div", { className: "row" },
    el("input", { type: "text", placeholder: first ? "Your name" : "Name", maxLength: 40, required: first, className: "m-name" }),
    el("input", { type: "text", placeholder: "UPI ID (name@bank)", maxLength: 100, className: "m-upi" }),
  );
  membersBox.append(row);
}

addMemberRow();
addMemberRow();
addMemberRow();
document.getElementById("add-member").onclick = () => addMemberRow();

document.getElementById("create").onsubmit = async (e) => {
  e.preventDefault();
  const error = document.getElementById("error");
  error.textContent = "";
  const members = [...membersBox.children]
    .map((row) => ({
      name: row.querySelector(".m-name").value.trim(),
      upi_id: row.querySelector(".m-upi").value.trim() || null,
    }))
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
