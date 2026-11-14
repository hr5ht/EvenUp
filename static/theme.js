// QuickTab is dark only, so there's no toggle. The top bar gets a hairline once the page scrolls under it.
addEventListener("scroll", () => document.querySelector(".topbar")?.classList.toggle("scrolled", scrollY > 8), { passive: true });
