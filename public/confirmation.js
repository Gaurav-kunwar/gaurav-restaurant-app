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

detailsElement.innerHTML = `
  <div><span>Placed</span><strong>${formatPlacedAt(confirmation.placedAt)}</strong></div>
  <div><span>Subtotal</span><strong>${rupees(confirmation.subtotal)}</strong></div>
  <div><span>Delivery charge</span><strong>${rupees(confirmation.deliveryCharge)}</strong></div>
  <div><span>Tax</span><strong>${rupees(confirmation.tax)}</strong></div>
  <div><span>Final total</span><strong>${rupees(confirmation.total)}</strong></div>
`;
