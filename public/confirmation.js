const CONFIRMATION_KEY = "gauravRestaurantLastOrder";
const ORDER_STATUSES = ["Pending", "Accepted", "Preparing", "Ready", "Out for Delivery", "Delivered"];

const orderIdElement = document.querySelector("#confirmationOrderId");
const detailsElement = document.querySelector("#confirmationDetails");
const timelineElement = document.querySelector("#statusTimeline");

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

function statusIndex(status) {
  return ORDER_STATUSES.indexOf(status);
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

function renderTimeline(status = confirmation.status || "Pending") {
  const currentIndex = statusIndex(status);
  const isCancelled = status === "Cancelled";
  const statuses = isCancelled ? [...ORDER_STATUSES.slice(0, 1), "Cancelled"] : ORDER_STATUSES;
  timelineElement.innerHTML = statuses.map((item) => {
    const index = statusIndex(item);
    const isCurrent = item === status;
    const isComplete = !isCancelled && index > -1 && index <= currentIndex;
    const className = ["timeline-step", isComplete ? "complete" : "", isCurrent ? "current" : "", item === "Cancelled" ? "cancelled" : ""]
      .filter(Boolean)
      .join(" ");
    return `
      <div class="${className}" aria-current="${isCurrent ? "step" : "false"}">
        <span></span>
        <strong>${item}</strong>
      </div>
    `;
  }).join("");
}

function renderDetails(status = confirmation.status || "Pending", statusUpdatedAt = confirmation.statusUpdatedAt || confirmation.placedAt) {
  detailsElement.innerHTML = `
  <div><span>Placed</span><strong>${formatPlacedAt(confirmation.placedAt)}</strong></div>
  <div><span>Status</span><strong id="confirmationStatus">${status}</strong></div>
  <div><span>Last updated</span><strong id="confirmationStatusUpdated">${formatPlacedAt(statusUpdatedAt)}</strong></div>
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
    const statusUpdatedElement = document.querySelector("#confirmationStatusUpdated");
    if (statusElement) statusElement.textContent = data.order.status;
    if (statusUpdatedElement) statusUpdatedElement.textContent = formatPlacedAt(data.order.status_updated_at);
    renderTimeline(data.order.status);
  } catch {
    // Keep the last known status visible if the latest status cannot be loaded.
  }
}

renderTimeline();
renderDetails();
refreshStatus();
