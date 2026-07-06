const menuForm = document.querySelector("#menuForm");
const adminMenuList = document.querySelector("#adminMenuList");
const reservationList = document.querySelector("#reservationList");
const orderList = document.querySelector("#orderList");
const logoutButton = document.querySelector("#logoutButton");
const dashboardFilters = document.querySelector("#dashboardFilters");
const dashboardCards = document.querySelector("#dashboardCards");
const dashboardRecentOrders = document.querySelector("#dashboardRecentOrders");
const dashboardTopItems = document.querySelector("#dashboardTopItems");
const ordersChart = document.querySelector("#ordersChart");
const revenueChart = document.querySelector("#revenueChart");
const emailTestButton = document.querySelector("#emailTestButton");
const emailTestStatus = document.querySelector("#emailTestStatus");
const orderStatuses = ["Pending", "Accepted", "Preparing", "Ready", "Out for Delivery", "Delivered", "Cancelled"];
let dashboardFilter = "today";

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function formatDateTime(value) {
  if (!value) return "Not captured";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function rupees(value) {
  return `Rs. ${Number(value).toLocaleString("en-IN")}`;
}

function empty(text) {
  return `<div class="admin-item"><small>${text}</small></div>`;
}

function numberLabel(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function deliveryAddress(order) {
  return order.full_address || [order.house_flat, order.street_area, order.landmark, order.city, order.state, order.pin_code]
    .filter(Boolean)
    .join(", ") || "Delivery address not captured";
}

function phoneHref(phone) {
  const text = String(phone || "").trim();
  const normalized = text.startsWith("+")
    ? `+${text.slice(1).replace(/\D/g, "")}`
    : text.replace(/\D/g, "");
  return normalized ? `tel:${normalized}` : "#";
}

function statusOptions(currentStatus) {
  return orderStatuses.map((status) => `
    <option value="${status}" ${status === currentStatus ? "selected" : ""}>${status}</option>
  `).join("");
}

function renderDashboardCards(summary) {
  const cards = [
    ["Total Orders", numberLabel(summary.totalOrders)],
    ["Today's Orders", numberLabel(summary.todaysOrders)],
    ["Pending Orders", numberLabel(summary.pendingOrders)],
    ["Delivered Orders", numberLabel(summary.deliveredOrders)],
    ["Cancelled Orders", numberLabel(summary.cancelledOrders)],
    ["Total Revenue", rupees(summary.totalRevenue)],
    ["Today's Revenue", rupees(summary.todayRevenue)]
  ];
  dashboardCards.innerHTML = cards.map(([label, value]) => `
    <div class="dashboard-card">
      <small>${label}</small>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function renderDashboardOrders(orders) {
  dashboardRecentOrders.innerHTML = orders.length ? orders.map((order) => `
    <div class="admin-item compact-admin-item">
      <strong><span>${escapeHtml(order.order_id || order.id)}</span><span>${rupees(order.final_total || order.total)}</span></strong>
      <small>${escapeHtml(order.customer_name)} | ${escapeHtml(order.status)} | ${formatDateTime(order.placed_at || order.created_at)}</small>
    </div>
  `).join("") : empty("No recent orders for this filter.");
}

function renderTopItems(items) {
  dashboardTopItems.innerHTML = items.length ? items.map((item, index) => `
    <div class="admin-item compact-admin-item">
      <strong><span>${index + 1}. ${escapeHtml(item.name)}</span><span>${numberLabel(item.quantity)} sold</span></strong>
      <small>Revenue: ${rupees(item.revenue)}</small>
    </div>
  `).join("") : empty("No best-selling items for this filter.");
}

function renderChart(element, points, key, formatter = numberLabel) {
  if (!points.length) {
    element.innerHTML = empty("No chart data for this filter.");
    return;
  }
  const max = Math.max(...points.map((point) => Number(point[key] || 0)), 1);
  element.innerHTML = points.map((point) => {
    const value = Number(point[key] || 0);
    const height = Math.max(8, Math.round((value / max) * 120));
    return `
      <div class="chart-bar">
        <div class="chart-track"><span style="height: ${height}px"></span></div>
        <small>${escapeHtml(point.label)}</small>
        <strong>${formatter(value)}</strong>
      </div>
    `;
  }).join("");
}

function setDashboardFilter(filter) {
  dashboardFilter = filter;
  dashboardFilters.querySelectorAll("[data-dashboard-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.dashboardFilter === filter);
  });
}

function renderDashboard(dashboard) {
  setDashboardFilter(dashboard.filter);
  renderDashboardCards(dashboard.summary);
  renderDashboardOrders(dashboard.recentOrders);
  renderTopItems(dashboard.topItems);
  renderChart(ordersChart, dashboard.charts, "orders");
  renderChart(revenueChart, dashboard.charts, "revenue", rupees);
}

async function loadAdmin() {
  const session = await api("/api/auth/me");
  if (!session.admin) {
    window.location.href = "/login.html";
    return;
  }

  const [dashboard, menu, reservations, orders] = await Promise.all([
    api(`/api/admin/dashboard?filter=${encodeURIComponent(dashboardFilter)}`),
    api("/api/menu"),
    api("/api/reservations"),
    api("/api/orders")
  ]);

  renderDashboard(dashboard);

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
      <strong><span>${escapeHtml(order.customer_name)}</span><span>${rupees(order.final_total || order.total)}</span></strong>
      <small>Order ID: ${escapeHtml(order.order_id || order.id)}</small>
      <small>Customer: ${escapeHtml(order.customer_name)} | Email: ${escapeHtml(order.customer_email || "Not captured")} | Phone: <a class="admin-link" href="${phoneHref(order.phone)}">${escapeHtml(order.phone)}</a></small>
      <small>Type: ${escapeHtml(order.order_type)} | Status: ${escapeHtml(order.status)} | Date: ${formatDateTime(order.placed_at || order.created_at)}</small>
      <small>Status updated: ${formatDateTime(order.status_updated_at || order.placed_at || order.created_at)}</small>
      <label class="admin-status">Status
        <select data-order-status="${order.id}">
          ${statusOptions(order.status)}
        </select>
      </label>
      <small>Address: ${escapeHtml(deliveryAddress(order))}</small>
      <small>${order.delivery_instructions ? `Instructions: ${escapeHtml(order.delivery_instructions)}` : "No delivery instructions"}</small>
      <small>Items: ${order.items.map((item) => `${escapeHtml(item.name)} x ${Number(item.quantity || 1)}`).join(", ")}</small>
      <button class="admin-danger" type="button" data-order-delete="${order.id}">Delete Order</button>
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

orderList.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-order-status]");
  if (!select) return;
  const status = select.value;
  try {
    await api(`/api/orders/${select.dataset.orderStatus}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await loadAdmin();
  } catch (error) {
    alert(error.message);
    await loadAdmin();
  }
});

orderList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-order-delete]");
  if (!button) return;
  const confirmed = confirm("Delete this order? It will move to Trash.");
  if (!confirmed) return;
  try {
    await api(`/api/orders/${button.dataset.orderDelete}`, { method: "DELETE" });
    await loadAdmin();
  } catch (error) {
    alert(error.message);
  }
});

dashboardFilters.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-dashboard-filter]");
  if (!button) return;
  setDashboardFilter(button.dataset.dashboardFilter);
  try {
    const dashboard = await api(`/api/admin/dashboard?filter=${encodeURIComponent(dashboardFilter)}`);
    renderDashboard(dashboard);
  } catch (error) {
    dashboardCards.innerHTML = empty(error.message);
  }
});

if (emailTestButton && emailTestStatus) {
  emailTestButton.addEventListener("click", async () => {
    emailTestButton.disabled = true;
    emailTestStatus.textContent = "Sending test email...";
    try {
      const result = await api("/api/admin/email-test", { method: "POST" });
      emailTestStatus.textContent = result.message || "Test email sent.";
    } catch (error) {
      emailTestStatus.textContent = error.message;
    } finally {
      emailTestButton.disabled = false;
    }
  });
}

logoutButton.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
});

loadAdmin().catch((error) => {
  adminMenuList.innerHTML = empty(error.message);
});
