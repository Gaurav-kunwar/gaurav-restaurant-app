const menuForm = document.querySelector("#menuForm");
const adminMenuList = document.querySelector("#adminMenuList");
const reservationList = document.querySelector("#reservationList");
const orderList = document.querySelector("#orderList");
const logoutButton = document.querySelector("#logoutButton");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function rupees(value) {
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

function empty(text) {
  return `<div class="admin-item"><small>${text}</small></div>`;
}

function deliveryAddress(order) {
  return order.full_address || [order.house_flat, order.street_area, order.landmark, order.city, order.pin_code]
    .filter(Boolean)
    .join(", ") || "Delivery address not captured";
}

async function loadAdmin() {
  const session = await api("/api/auth/me");
  if (!session.admin) {
    window.location.href = "/login.html";
    return;
  }

  const [menu, reservations, orders] = await Promise.all([
    api("/api/menu"),
    api("/api/reservations"),
    api("/api/orders")
  ]);

  adminMenuList.innerHTML = menu.items.length ? menu.items.map((item) => `
    <div class="admin-item">
      <strong><span>${item.name}</span><span>${rupees(item.price)}</span></strong>
      <small>${item.category} | ${item.is_veg ? "Veg" : "Non-veg"} | ${item.is_available ? "Available" : "Hidden"}</small>
      <small>${item.description}</small>
    </div>
  `).join("") : empty("No menu items yet.");

  reservationList.innerHTML = reservations.reservations.length ? reservations.reservations.map((item) => `
    <div class="admin-item">
      <strong><span>${item.customer_name}</span><span>${item.guests} guests</span></strong>
      <small>${item.phone} | ${item.reservation_date} at ${item.reservation_time}</small>
      <small>${item.note || "No note"} | Status: ${item.status}</small>
    </div>
  `).join("") : empty("No booking requests yet.");

  orderList.innerHTML = orders.orders.length ? orders.orders.map((order) => `
    <div class="admin-item">
      <strong><span>${order.customer_name}</span><span>${rupees(order.total)}</span></strong>
      <small>${order.phone} | ${order.order_type} | ${order.status}</small>
      <small>Address: ${deliveryAddress(order)}</small>
      <small>${order.delivery_instructions ? `Instructions: ${order.delivery_instructions}` : "No delivery instructions"}</small>
      <small>${order.items.map((item) => item.name).join(", ")}</small>
    </div>
  `).join("") : empty("No orders yet.");
}

menuForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#menuStatus");
  const data = Object.fromEntries(new FormData(menuForm));
  data.price = Number(data.price);
  data.is_veg = data.is_veg === "1";
  data.is_available = menuForm.elements.is_available.checked;
  try {
    await api("/api/menu", { method: "POST", body: JSON.stringify(data) });
    status.textContent = "Menu item saved.";
    menuForm.reset();
    menuForm.elements.is_available.checked = true;
    await loadAdmin();
  } catch (error) {
    status.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
});

loadAdmin().catch((error) => {
  adminMenuList.innerHTML = empty(error.message);
});
