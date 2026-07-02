const trashList = document.querySelector("#trashList");
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
  return `â‚¹${Number(value).toLocaleString("en-IN")}`;
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

function empty(text) {
  return `<div class="admin-item"><small>${text}</small></div>`;
}

function formatDateTime(value) {
  if (!value) return "Not captured";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
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

function renderOrder(order) {
  return `
    <div class="admin-item">
      <strong><span>${escapeHtml(order.customer_name)}</span><span>${rupees(order.final_total || order.total)}</span></strong>
      <small>Order ID: ${escapeHtml(order.order_id || order.id)}</small>
      <small>Customer: ${escapeHtml(order.customer_name)} | Phone: <a class="admin-link" href="${phoneHref(order.phone)}">${escapeHtml(order.phone)}</a></small>
      <small>Status: ${escapeHtml(order.status)} | Date: ${formatDateTime(order.placed_at || order.created_at)}</small>
      <small>Status updated: ${formatDateTime(order.status_updated_at || order.placed_at || order.created_at)}</small>
      <small>Deleted: ${formatDateTime(order.deleted_at)}</small>
      <small>Address: ${escapeHtml(deliveryAddress(order))}</small>
      <small>Items: ${order.items.map((item) => `${escapeHtml(item.name)} x ${Number(item.quantity || 1)}`).join(", ")}</small>
      <div class="admin-actions">
        <button class="btn secondary" type="button" data-order-restore="${order.id}">Restore</button>
        <button class="admin-danger" type="button" data-order-permanent-delete="${order.id}">Delete Permanently</button>
      </div>
    </div>
  `;
}

async function loadTrash() {
  const session = await api("/api/auth/me");
  if (!session.admin) {
    window.location.href = "/login.html";
    return;
  }

  const trash = await api("/api/orders/trash");
  trashList.innerHTML = trash.orders.length ? trash.orders.map(renderOrder).join("") : empty("Trash is empty.");
}

trashList.addEventListener("click", async (event) => {
  const restoreButton = event.target.closest("[data-order-restore]");
  const deleteButton = event.target.closest("[data-order-permanent-delete]");

  try {
    if (restoreButton) {
      const confirmed = confirm("Restore this order to Order History?");
      if (!confirmed) return;
      await api(`/api/orders/${restoreButton.dataset.orderRestore}/restore`, { method: "PATCH" });
      await loadTrash();
    }

    if (deleteButton) {
      const confirmed = confirm("Permanently delete this order? This cannot be undone.");
      if (!confirmed) return;
      await api(`/api/orders/${deleteButton.dataset.orderPermanentDelete}/permanent`, { method: "DELETE" });
      await loadTrash();
    }
  } catch (error) {
    alert(error.message);
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
});

loadTrash().catch((error) => {
  trashList.innerHTML = empty(error.message);
});
