const $ = (id) => document.getElementById(id);

// One person: avatar, name and email, then their buttons.
function row(p, ...acts) {
  return el("div", { className: "person" }, avatar(p.name || p.email),
    el("span", { className: "grow" }, el("strong", { textContent: p.name || p.email }), p.name ? el("span", { textContent: p.email }) : null),
    el("span", { className: "acts" }, ...acts));
}

function action(label, url, method = "POST", className = "small") {
  const button = el("button", { type: "button", className, textContent: label });
  button.onclick = async () => {
    button.disabled = true;
    $("error").textContent = "";
    try {
      await authed(method, url);
      await load();
    } catch (err) {
      $("error").textContent = err.message;
      button.disabled = false;
    }
  };
  return button;
}

function fill(id, rows, empty) {
  $(id).replaceChildren(...(rows.length ? rows : empty ? [el("p", { className: "empty-line", textContent: empty })] : []));
}

async function load() {
  const { friends, requests, sent } = await authed("GET", "/api/friends");
  fill("requests", requests.map((p) => row(p,
    action("Decline", `/api/friends/${p.id}/decline`), action("Accept", `/api/friends/${p.id}/accept`, "POST", "small primary"))));
  fill("friends", friends.map((p) => row(p, action("Remove", `/api/friends/${p.id}`, "DELETE", "small ghost"))), "No friends yet. Add one by email above.");
  fill("sent", sent.map((p) => row(p, action("Cancel", `/api/friends/${p.id}`, "DELETE", "small ghost"))));
  $("requests-card").hidden = !requests.length;
  $("sent-card").hidden = !sent.length;
}

$("add").onsubmit = async (e) => {
  e.preventDefault();
  $("error").textContent = $("note").textContent = "";
  $("send").disabled = true;
  try {
    await authed("POST", "/api/friends", { email: $("email").value.trim() });
    $("note").textContent = `Request sent to ${$("email").value.trim()}.`;
    $("email").value = "";
    await load();
  } catch (err) {
    $("error").textContent = err.status === 422 ? "That doesn't look like an email address." : err.message;
  }
  $("send").disabled = false;
};

load().then(() => ($("page").hidden = false)).catch((err) => {
  if (!needAccount(err)) {
    $("page").hidden = false;
    $("error").textContent = err.message;
  }
});
