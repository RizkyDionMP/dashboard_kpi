// auth.js

// valid credentials (bisa kamu ganti)
const ADMIN_EMAIL = "admin@mazta.com";
const ADMIN_PASSWORD = "mazta123";

// Login page logic
if (window.location.pathname.includes("login.html")) {
  document.getElementById("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      localStorage.setItem("isLoggedIn", "true");
      window.location.href = "index.html";
    } else {
      document.getElementById("error").classList.remove("hidden");
    }
  });
}

// Index page logic (block if not logged in)
if (window.location.pathname.includes("index.html")) {
  if (localStorage.getItem("isLoggedIn") !== "true") {
    window.location.href = "login.html";
  }
}
