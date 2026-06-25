const loginForm = document.querySelector("#loginForm");
const statusLine = document.querySelector("#loginStatus");

async function login(body) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Login failed");
  return data;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusLine.textContent = "Checking...";
  try {
    await login(Object.fromEntries(new FormData(loginForm)));
    window.location.href = "/admin";
  } catch (error) {
    statusLine.textContent = error.message;
  }
});
