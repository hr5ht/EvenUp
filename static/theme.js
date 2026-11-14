// Light or dark: the system decides unless the toggle saved a choice. Runs in <head>, before paint, so there's no flash.
const media = matchMedia("(prefers-color-scheme: dark)");
const root = document.documentElement;
root.classList.add("js"); // lets CSS hide things that JS will animate in
function applyTheme(saved) {
  if (saved) root.dataset.theme = saved; else delete root.dataset.theme;
  const dark = saved ? saved === "dark" : media.matches;
  root.toggleAttribute("data-dark", dark);
  // The browser bar matches the page; a page with data-fixed (the green home hero) keeps its own colour.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && !meta.hasAttribute("data-fixed")) meta.setAttribute("content", dark ? "#161513" : "#f7f4ee");
}
const stored = () => { try { return localStorage.getItem("quicktab:theme"); } catch { return null; } };
applyTheme(stored());
media.addEventListener("change", () => applyTheme(stored()));
addEventListener("DOMContentLoaded", () => {
  applyTheme(stored()); // the theme-color meta exists now
  document.getElementById("theme").onclick = () => {
    const next = root.hasAttribute("data-dark") ? "light" : "dark";
    try { localStorage.setItem("quicktab:theme", next); } catch { /* private mode: this visit only */ }
    applyTheme(next);
  };
});

// The top bar gets a soft shadow once the page scrolls under it.
addEventListener("scroll", () => document.querySelector(".topbar")?.classList.toggle("scrolled", scrollY > 8), { passive: true });
