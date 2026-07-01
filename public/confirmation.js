const CONFIRMATION_KEY = "gauravRestaurantLastOrder";

const orderIdElement = document.querySelector("#confirmationOrderId");
const detailsElement = document.querySelector("#confirmationDetails");

function rupees(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function formatPlacedAt(value) {
  if (!value) return "Just now";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

const params = new URLSearchParams(window.location.search);
const orderFromUrl = params.get("order");
let confirmation = {};

try {
  confirmation = JSON.parse(sessionStorage.getItem(CONFIRMATION_KEY) || "{}");
} catch {
  confirmation = {};
}

const orderId = orderFromUrl || confirmation.orderId || "Pending";
orderIdElement.textContent = orderId;

function renderDetails(status = confirmation.status || "Pending") {
  detailsElement.innerHTML = `
  <div><span>Placed</span><strong>${formatPlacedAt(confirmation.placedAt)}</strong></div>
  <div><span>Status</span><strong id="confirmationStatus">${status}</strong></div>
  <div><span>Subtotal</span><strong>${rupees(confirmation.subtotal)}</strong></div>
  <div><span>Delivery charge</span><strong>${rupees(confirmation.deliveryCharge)}</strong></div>
  <div><span>Tax</span><strong>${rupees(confirmation.tax)}</strong></div>
  <div><span>Final total</span><strong>${rupees(confirmation.total)}</strong></div>
  `;
}

async function refreshStatus() {
  if (!orderId || orderId === "Pending") return;
  try {
    const response = await fetch(`/api/order-status?orderId=${encodeURIComponent(orderId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load order status");
    const statusElement = document.querySelector("#confirmationStatus");
    if (statusElement) statusElement.textContent = data.order.status;
  } catch {
    // Keep the last known status visible if the latest status cannot be loaded.
  }
}

renderDetails();
refreshStatus();
