// Signed-in pages: your name and email at the foot of the sidebar.
authed("GET", "/api/me").then((me) => {
  document.getElementById("side-name").textContent = me.name;
  document.getElementById("side-email").textContent = me.email;
  document.getElementById("side-avatar").textContent = initials(me.name);
}).catch(() => {}); // a signed-out visitor is the page script's job
