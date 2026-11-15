const $ = (id) => document.getElementById(id);
const value = (id) => $(id).value.trim();

function fill(me) {
  $("email").textContent = me.email;
  $("who-name").textContent = me.name;
  $("big-avatar").textContent = initials(me.name);
  $("name").value = me.name;
  $("upi").value = me.upi_id || "";
}

function signedOut() {
  remember(false);
  $("signed-in").hidden = true;
  $("signed-out").hidden = false;
}

(async () => {
  if (!signedIn()) return signedOut();
  try {
    fill(await authed("GET", "/api/me"));
    $("signed-in").hidden = false;
  } catch (err) {
    if (err.status === 401) signedOut();
    else ($("signed-out").hidden = false), ($("signed-out").querySelector(".muted").textContent = err.message);
  }
})();

$("profile").onsubmit = async (e) => {
  e.preventDefault();
  $("error").textContent = "";
  $("save").disabled = true;
  try {
    fill(await authed("PATCH", "/api/me", { name: value("name"), upi_id: value("upi") || null }));
    $("save").textContent = "Saved";
    setTimeout(() => ($("save").textContent = "Save"), 1500);
  } catch (err) {
    $("error").textContent = err.status === 422 ? "That doesn't look like a UPI ID (name@bank)." : err.message;
  }
  $("save").disabled = false;
};

$("sign-out").onclick = async () => {
  await api("POST", "/auth/sign-out", {}).catch(() => {});
  signedOut();
};

$("delete").onclick = async () => {
  $("delete-error").textContent = "";
  if (!$("delete-password").value) return ($("delete-error").textContent = "Enter your password");
  if (!confirm("Delete your account? This can't be undone.")) return;
  $("delete").disabled = true;
  try {
    await authToken(true); // the session ends with the account, so take the token for our own delete first
    await api("POST", "/auth/delete-user", { password: $("delete-password").value });
    await authed("DELETE", "/api/me");
    signedOut();
  } catch (err) {
    $("delete-error").textContent = err.message;
    $("delete").disabled = false;
  }
};
