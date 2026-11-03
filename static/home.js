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

// ---------- motion ----------
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Reveal blocks as they scroll into view, once. Count-ups run when their block appears.
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add("in");
    seen.unobserve(e.target);
    e.target.querySelectorAll("[data-count]").forEach((n) => { n.dataset.value = 0; countUp(n, Number(n.dataset.count), String, 1200); });
    e.target.querySelectorAll("[data-count-paise]").forEach((n) => { n.dataset.value = 0; countUp(n, Number(n.dataset.countPaise), rupees, 1400); });
  }
}, { threshold: 0.2, rootMargin: "0px 0px -40px" });
document.querySelectorAll("[data-reveal]").forEach((n) => seen.observe(n));

// Spotlight: every cell in a grid lights up around the cursor, so the glow crosses cell borders.
document.querySelectorAll(".spot").forEach((grid) => grid.addEventListener("pointermove", (e) => {
  for (const cell of grid.children) {
    const r = cell.getBoundingClientRect();
    cell.style.setProperty("--mx", `${e.clientX - r.left}px`);
    cell.style.setProperty("--my", `${e.clientY - r.top}px`);
  }
}));

// The New tab placeholder types out example names while the box is empty and not focused.
if (!still) {
  const names = ["Riya", "Kabir", "Aman", "Your name"];
  let i = 0, n = 0, back = false;
  const tick = () => {
    if (mode() === "new" && !cmd.value && document.activeElement !== cmd) {
      const word = names[i % names.length];
      n += back ? -1 : 1;
      cmd.placeholder = `${word.slice(0, n)}▍`;
      if (n === word.length) { back = true; return setTimeout(tick, 1600); }
      if (n === 0) { back = false; i++; }
    } else if (mode() === "new") {
      cmd.placeholder = MODES.new[0];
    }
    setTimeout(tick, back ? 45 : 95);
  };
  setTimeout(tick, 1800);
}
