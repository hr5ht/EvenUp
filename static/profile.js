const $ = (id) => document.getElementById(id);
const value = (id) => $(id).value.trim();

function fill(me) {
  $("email").textContent = me.email;
  $("who-name").textContent = me.name;
  $("big-avatar").textContent = initials(me.name);
  $("name").value = me.name;
  $("upi").value = me.upi_id || "";
  $("view-name").textContent = me.name;
  $("view-upi").textContent = me.upi_id || "Not added";
  $("view-upi").className = me.upi_id ? "mono" : "dim";
  editing(false);
}

// Your details read as text; Edit opens the boxes, Save or Cancel closes them.
function editing(on) {
  $("details-view").hidden = on;
  $("details-edit").hidden = !on;
  $("edit").hidden = on;
  $("error").textContent = "";
  if (on) $("name").focus();
}
let me;
$("edit").onclick = () => editing(true);
$("cancel").onclick = () => fill(me);

function signedOut() {
  remember(false);
  $("signed-in").hidden = true;
  $("signed-out").hidden = false;
}

(async () => {
  if (!signedIn()) return signedOut();
  try {
    fill((me = await authed("GET", "/api/me")));
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
    fill((me = await authed("PATCH", "/api/me", { name: value("name"), upi_id: value("upi") || null })));
  } catch (err) {
    $("error").textContent = err.status === 422 ? "That doesn't look like a UPI ID (name@bank)." : err.message;
  }
  $("save").disabled = false;
};

$("sign-out").onclick = async () => {
  await api("POST", "/auth/sign-out", {}).catch(() => {});
  signedOut();
};

$("delete-form").onsubmit = async (e) => {
  e.preventDefault();
  $("delete-error").textContent = "";
  $("delete").disabled = true;
  try {
    await authToken(true); // the session ends with the account, so take the token for our own delete first
    await api("POST", "/auth/delete-user", { password: $("delete-password").value });
    await authed("DELETE", "/api/me");
    $("delete-sheet").close();
    signedOut();
  } catch (err) {
    $("delete-error").textContent = err.message;
    $("delete").disabled = false;
  }
};
