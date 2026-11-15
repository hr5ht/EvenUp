// Home page: reveal on scroll, the hero amount counting up, the demo buttons, and account links once signed in.
const $ = (id) => document.getElementById(id);

const io = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}), { threshold: 0.15 });
document.querySelectorAll(".rv").forEach((el) => io.observe(el));

addEventListener("scroll", () => $("nav").classList.toggle("scrolled", scrollY > 8), { passive: true });

// The phone's "You owe" counts up once the phone has risen.
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  for (const el of document.querySelectorAll("[data-to]")) {
    const to = +el.dataset.to, start = performance.now() + 900, f = new Intl.NumberFormat("en-IN");
    const tick = (t) => {
      const p = Math.min(1, Math.max(0, (t - start) / 1400));
      el.textContent = "₹" + f.format(Math.round(to * (1 - (1 - p) ** 4)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

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
