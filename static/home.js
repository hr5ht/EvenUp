// The command bar: New tab (your name → /new), Join tab (paste a link → the tab), Demo.
const $ = (id) => document.getElementById(id);
const cmd = $("cmd");
const MODES = {
  new: ["Your name, to open a tab", "Your name"],
  join: ["Paste a tab link, like quicktabapp.vercel.app/g/…", "Tab link"],
  demo: ["Press enter for a filled-in demo tab", "Demo"],
};
const mode = () => document.querySelector('input[name="mode"]:checked').value;
document.querySelectorAll('input[name="mode"]').forEach((r) => (r.onchange = () => {
  const [placeholder, label] = MODES[mode()];
  Object.assign(cmd, { placeholder, value: "", disabled: mode() === "demo" });
  cmd.setAttribute("aria-label", label);
  if (mode() === "demo") $("command").querySelector(".go").focus();
  else cmd.focus();
}));

// "Live demo": the server makes a filled-in tab, this device opens it as Guest, the admin.
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

$("command").onsubmit = (e) => {
  e.preventDefault();
  const v = cmd.value.trim();
  if (mode() === "demo") return demo(e.submitter || $("command").querySelector(".go"));
  if (mode() === "new") return (location.href = v ? `/new?name=${encodeURIComponent(v)}` : "/new");
  // Accept a full link or just the code after /g/.
  const slug = v.split("/g/").pop().split(/[?#/\s]/)[0];
  if (!slug) return ($("demo-error").textContent = "Paste the link your friend shared.");
  location.href = `/g/${encodeURIComponent(slug)}`;
};
