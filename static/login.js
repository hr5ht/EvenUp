const $ = (id) => document.getElementById(id);
const value = (id) => $(id).value.trim();
const pending = new URLSearchParams(location.search);
const resetToken = pending.get("token");

// One form, four jobs. Each lists the fields it shows and the two links under the button.
const MODES = {
  signin: { title: "Sign in", sub: "Your groups and friends, on any device.", button: "Sign in", fields: ["email", "password"],
    links: [["New here? Create an account", "signup"], ["Forgot password?", "forgot"]] },
  signup: { title: "Create your account", sub: "You can add your UPI ID later, in your profile.", button: "Create account",
    fields: ["name", "email", "password"], links: [["Already have an account? Sign in", "signin"]] },
  forgot: { title: "Reset your password", sub: "We'll email you a link. It works for 15 minutes.", button: "Send reset link", fields: ["email"],
    links: [["Back to sign in", "signin"]] },
  reset: { title: "Choose a new password", button: "Save password", fields: ["password"], links: [["Back to sign in", "signin"]] },
};
let mode;

function show(next, note = "") {
  mode = next;
  const m = MODES[mode];
  document.title = `${m.title} · EvenUp`;
  $("title").textContent = m.title;
  $("sub").textContent = m.sub || "";
  $("submit").textContent = m.button;
  $("note").textContent = note;
  $("error").textContent = "";
  for (const box of document.querySelectorAll("[data-field]")) {
    const on = m.fields.includes(box.dataset.field);
    box.hidden = !on;
    box.querySelector("input").required = on;
  }
  const signingIn = mode === "signin";
  $("password").minLength = signingIn ? 0 : 8; // old passwords aren't ours to re-check, and a hint here helps nobody
  $("password").placeholder = signingIn ? "Your password" : "At least 8 characters";
  $("password").autocomplete = signingIn ? "current-password" : "new-password";
  $("password-label").textContent = mode === "reset" ? "New password" : "Password";
  ["alt-1", "alt-2"].forEach((id, i) => {
    const link = m.links[i];
    $(id).hidden = !link;
    if (link) {
      $(id).textContent = link[0];
      $(id).onclick = () => show(link[1]);
    }
  });
}

// Back to the page that sent you here (a group's link), or your dashboard. Only paths on this site.
const next = /^\/(?![/\\])/.test(pending.get("next") || "") ? pending.get("next") : "/";

function goIn() {
  remember(true);
  location.replace(next);
}

async function signIn() {
  await api("POST", "/auth/sign-in/email", { email: value("email"), password: $("password").value });
  goIn();
}

const SUBMIT = {
  signin: signIn,
  signup: async () => {
    await api("POST", "/auth/sign-up/email", { name: value("name"), email: value("email"), password: $("password").value });
    goIn();
  },
  forgot: async () => {
    await api("POST", "/auth/request-password-reset", { email: value("email"), redirectTo: `${location.origin}/login` });
    show("signin", "If that email has an account, a reset link is on its way.");
  },
  reset: async () => {
    await api("POST", "/auth/reset-password", { newPassword: $("password").value, token: resetToken });
    history.replaceState(null, "", "/login"); // the token is single use, and shouldn't sit in the address bar
    $("password").value = "";
    show("signin", "Password changed. Sign in with the new one.");
  },
};

$("auth").onsubmit = async (e) => {
  e.preventDefault();
  $("error").textContent = "";
  $("submit").disabled = true;
  try {
    await SUBMIT[mode]();
  } catch (err) {
    $("error").textContent = err.message;
  }
  $("submit").disabled = false;
};

if (resetToken) show("reset");
else if (pending.get("error")) show("forgot", "That link has expired. Ask for a new one.");
else {
  show(pending.get("mode") === "signup" ? "signup" : "signin");
  authToken().then((t) => t && goIn()); // already signed in
}
