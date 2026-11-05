const $ = (id) => document.getElementById(id);
const value = (id) => $(id).value.trim();
const pending = new URLSearchParams(location.search);
const resetToken = pending.get("token");

// One form, five jobs. Each lists the fields it shows and the two links under the button.
const MODES = {
  signin: { title: "Sign in", sub: "Your groups and friends, on any device.", button: "Sign in", fields: ["email", "password"],
    links: [["New here? Create an account", "signup"], ["Forgot password?", "forgot"]] },
  signup: { title: "Create your account", sub: "You can add your UPI ID later, in your profile.", button: "Create account",
    fields: ["name", "email", "password"], links: [["Already have an account? Sign in", "signin"]] },
  verify: { title: "Check your email", button: "Verify email", fields: ["code"], links: [["Send a new code", "resend"], ["Back to sign in", "signin"]] },
  forgot: { title: "Reset your password", sub: "We'll email you a link. It works for 15 minutes.", button: "Send reset link", fields: ["email"],
    links: [["Back to sign in", "signin"]] },
  reset: { title: "Choose a new password", button: "Save password", fields: ["password"], links: [["Back to sign in", "signin"]] },
};
let mode;

function show(next, note = "") {
  mode = next;
  const m = MODES[mode];
  document.title = `${m.title} · QuickTab`;
  $("title").textContent = m.title;
  $("sub").textContent = mode === "verify" ? `Enter the code we sent to ${value("email")}. It works for 15 minutes.` : m.sub || "";
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
      $(id).onclick = () => (link[1] === "resend" ? resend() : show(link[1]));
    }
  });
}

const goIn = () => location.replace("/friends");

async function resend() {
  $("error").textContent = "";
  try {
    await api("POST", "/auth/send-verification-email", { email: value("email"), callbackURL: `${location.origin}/login` });
    $("note").textContent = "New code sent.";
  } catch (err) {
    $("error").textContent = err.message;
  }
}

async function signIn() {
  await api("POST", "/auth/sign-in/email", { email: value("email"), password: $("password").value });
  goIn();
}

const SUBMIT = {
  signin: async () => {
    try {
      await signIn();
    } catch (err) {
      if (err.status !== 403) throw err; // 403: the password was right, the email isn't verified yet
      show("verify");
      await resend();
    }
  },
  signup: async () => {
    const r = await api("POST", "/auth/sign-up/email", { name: value("name"), email: value("email"), password: $("password").value });
    if (r.user?.emailVerified) goIn();
    else show("verify");
  },
  verify: async () => {
    await api("POST", "/auth/email-otp/verify-email", { email: value("email"), otp: value("code") });
    if (await authToken(true)) goIn();
    else await signIn(); // Neon's auto sign-in is off
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
else if (pending.has("unverified")) show("signin", "Verify your email to continue. Sign in and we'll send you a code.");
else {
  show("signin");
  authToken().then((t) => t && goIn()); // already signed in
}
