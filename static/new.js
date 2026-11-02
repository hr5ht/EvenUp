const membersBox = document.getElementById("members");

function addMemberRow(name = "") {
  const row = el("div", { className: "row" },
    el("input", { type: "text", placeholder: "Name", maxLength: 40, value: name, className: "m-name" }),
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
    const { slug, admin_token } = await api("POST", "/api/splits", {
      name: document.getElementById("name").value.trim(),
      members,
      website: document.getElementById("website").value,
    });
    const share = `${location.origin}/g/${slug}`;
    // Token sits in the URL fragment, which browsers never send to the server.
    const admin = `${share}#admin=${admin_token}`;
    document.getElementById("share-link").textContent = share;
    document.getElementById("admin-link").textContent = admin;
    document.getElementById("copy-share").onclick = (ev) => copyText(share, ev.target);
    document.getElementById("copy-admin").onclick = (ev) => copyText(admin, ev.target);
    document.getElementById("open").href = admin;
    document.getElementById("create").hidden = true;
    document.getElementById("created").hidden = false;
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
  }
};
