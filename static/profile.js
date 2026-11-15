const $ = (id) => document.getElementById(id);
function toLogin() {
  remember(false);
  location.replace("/login");
}

function fill(me) {
  $("email").textContent = me.email;
  $("who-name").textContent = me.name;
  $("big-avatar").textContent = initials(me.name);
  $("name").value = me.name;
  $("upi").value = me.upi_id || "";
}

(async () => {
  try {
    fill(await authed("GET", "/api/me"));
    $("page").hidden = false;
  } catch (err) {
    if (!needAccount(err)) $("email").textContent = err.message;
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

function value(id) { return $(id).value.trim(); }

$("sign-out").onclick = async () => {
  await api("POST", "/auth/sign-out", {}).catch(() => {});
  toLogin();
};

$("delete").onclick = async () => {
  $("delete-error").textContent = "";
  if (!$("delete-password").value) return ($("delete-error").textContent = "Enter your password");
  $("delete").disabled = true;
  try {
    await authToken(true); // the session ends with the account, so take the token for our own delete first
    await api("POST", "/auth/delete-user", { password: $("delete-password").value });
    await authed("DELETE", "/api/me");
    toLogin();
  } catch (err) {
    $("delete-error").textContent = err.message;
    $("delete").disabled = false;
  }
};
