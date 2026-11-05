const $ = (id) => document.getElementById(id);

function who(person) {
  return person.name
    ? el("div", { className: "who" }, el("strong", { textContent: person.name }), el("span", { className: "muted", textContent: person.email }))
    : el("div", { className: "who" }, el("span", { textContent: person.email }));
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
  $(id).replaceChildren(...(rows.length ? rows : empty ? [el("li", { className: "muted", textContent: empty })] : []));
}

async function load() {
  const { friends, requests, sent } = await authed("GET", "/api/friends");
  fill("requests", requests.map((p) => el("li", {}, who(p),
    action("Accept", `/api/friends/${p.id}/accept`, "POST", "small primary"), action("Decline", `/api/friends/${p.id}/decline`))));
  fill("friends", friends.map((p) => el("li", {}, who(p), action("Remove", `/api/friends/${p.id}`, "DELETE"))), "No friends yet. Add one by email above.");
  fill("sent", sent.map((p) => el("li", {}, who(p), action("Cancel", `/api/friends/${p.id}`, "DELETE"))));
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
