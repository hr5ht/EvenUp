// "Try a live demo": the server makes a filled-in split, this device opens it as Guest, the admin.
const demoBtn = document.getElementById("demo");
demoBtn.onclick = async () => {
  demoBtn.disabled = true;
  demoBtn.textContent = "Setting up a demo…";
  try {
    const { slug, admin_token, admin_id } = await api("POST", "/api/demo");
    saveIdentity(slug, { me: admin_id, adminToken: admin_token });
    location.href = `/g/${slug}`;
  } catch (err) {
    document.getElementById("demo-error").textContent = err.message;
    demoBtn.disabled = false;
    demoBtn.textContent = "Try a live demo";
  }
};
