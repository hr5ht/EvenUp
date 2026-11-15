// Signed-in pages: your name and email at the foot of the sidebar.
authed("GET", "/api/me").then((me) => {
  document.getElementById("side-name").textContent = me.name;
  document.getElementById("side-email").textContent = me.email;
  document.getElementById("side-avatar").textContent = initials(me.name);
}).catch(() => {}); // a signed-out visitor is the page script's job

// + New, in the sidebar or the phone's bottom bar, asks which: a quick tab or a group.
const newSheet = document.getElementById("new-sheet");
document.querySelectorAll("[data-open=new-sheet], .tab-plus").forEach((b) => (b.onclick = (ev) => { ev.preventDefault(); newSheet.showModal(); }));
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (ev) => ev.target === d && d.close()));
