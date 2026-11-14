// Hero form: your name opens a tab (→ /new). "Join with a link" switches it to paste a tab link instead.
const $ = (id) => document.getElementById(id);
const cmd = $("cmd");
let joining = false;

$("join").onclick = () => {
  joining = !joining;
  Object.assign(cmd, { value: "", placeholder: joining ? "Paste the tab link" : "Your name" });
  cmd.setAttribute("aria-label", joining ? "Tab link" : "Your name");
  $("go").textContent = joining ? "Join tab" : "Open a tab";
  $("join").textContent = joining ? "Open a new tab instead" : "Join with a link";
  $("demo-error").textContent = "";
  cmd.focus();
};

$("command").onsubmit = (e) => {
  e.preventDefault();
  const v = cmd.value.trim();
  if (!joining) return (location.href = v ? `/new?name=${encodeURIComponent(v)}` : "/new");
  // Accept a full link or just the code after /g/.
  const slug = v.split("/g/").pop().split(/[?#/\s]/)[0];
  if (!slug) return ($("demo-error").textContent = "Paste the link your friend shared.");
  location.href = `/g/${encodeURIComponent(slug)}`;
};

// The demo: the server makes a filled-in tab, and this device opens it as Guest, the admin.
async function demo(button) {
  button.disabled = true;
  $("demo-error").textContent = "";
  try {
    const { slug, admin_token, admin_id } = await api("POST", "/api/demo");
    saveIdentity(slug, { me: admin_id, adminToken: admin_token });
    location.href = `/g/${slug}`;
  } catch (err) {
    $("demo-error").textContent = err.message;
    button.disabled = false;
  }
}
$("demo").onclick = (e) => demo(e.currentTarget);
$("demo-2").onclick = (e) => demo(e.currentTarget);

// Signed in: every account link leads to the dashboard instead.
if (signedIn()) {
  $("account").textContent = "Dashboard";
  $("cta-account").textContent = "Go to your dashboard";
  $("foot-signin").textContent = "Dashboard";
  $("announce").href = "/friends";
  $("foot-signup").remove();
  for (const id of ["account", "cta-account", "foot-signin"]) $(id).href = "/dashboard";
}
