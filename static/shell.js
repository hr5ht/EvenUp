// Pages with the bottom bar. Signed in, + asks what to start (a tab or a group); signed out it opens a new tab.
// data-open / data-close buttons open and close sheets, and tapping the dimmed backdrop closes one.
document.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => document.getElementById(b.dataset.open).showModal()));
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (ev) => ev.target === d && d.close()));
const plus = document.getElementById("plus");
if (plus && signedIn() && document.getElementById("new-sheet")) {
  plus.onclick = (ev) => { ev.preventDefault(); document.getElementById("new-sheet").showModal(); };
}
