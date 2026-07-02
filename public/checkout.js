const CART_STORAGE_KEY = "gauravRestaurantCart";
const CHECKOUT_DETAILS_KEY = "gauravRestaurantCheckoutDetails";
const CONFIRMATION_KEY = "gauravRestaurantLastOrder";
const DELIVERY_CHARGE = 49;
const TAX_RATE = 0.05;

const state = {
  menu: [],
  cart: []
};

const checkoutForm = document.querySelector("#checkoutForm");
const checkoutCart = document.querySelector("#checkoutCart");
const checkoutStatus = document.querySelector("#checkoutStatus");
const cartCount = document.querySelector("#cartCount");

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

function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");
    state.cart = Array.isArray(saved)
      ? saved
          .map((item) => ({ id: Number(item.id), quantity: Number(item.quantity) }))
          .filter((item) => Number.isInteger(item.id) && Number.isInteger(item.quantity) && item.quantity > 0)
      : [];
  } catch {
    state.cart = [];
  }
}

function saveCart() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
}

function getCartDetails() {
  return state.cart
    .map((cartItem) => {
      const menuItem = state.menu.find((item) => item.id === cartItem.id);
      if (!menuItem) return null;
      return { ...menuItem, quantity: cartItem.quantity, lineTotal: menuItem.price * cartItem.quantity };
    })
    .filter(Boolean);
}

function getTotals() {
  const items = getCartDetails();
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const total = items.length ? subtotal + DELIVERY_CHARGE + tax : 0;
  return { items, subtotal, deliveryCharge: items.length ? DELIVERY_CHARGE : 0, tax, total };
}

function renderCartCount() {
  cartCount.textContent = state.cart.reduce((sum, item) => sum + item.quantity, 0);
}

function renderSummary() {
  renderCartCount();
  const { items, subtotal, deliveryCharge, tax, total } = getTotals();
  if (items.length === 0) {
    checkoutCart.innerHTML = `
      <p>Your cart is empty</p>
      <a class="btn primary" href="/#menu">Add Items</a>
    `;
    return;
  }

  checkoutCart.innerHTML = items.map((item) => `
    <div class="cart-row checkout-row">
      <div class="cart-item">
        <strong>${item.name}</strong>
        <span>${item.quantity} x ${rupees(item.price)}</span>
      </div>
      <strong>${rupees(item.lineTotal)}</strong>
    </div>
  `).join("") + `
    <div class="cart-summary"><span>Subtotal</span><strong>${rupees(subtotal)}</strong></div>
    <div class="cart-summary"><span>Delivery charge</span><strong>${rupees(deliveryCharge)}</strong></div>
    <div class="cart-summary"><span>Tax (GST 5%)</span><strong>${rupees(tax)}</strong></div>
    <div class="cart-summary total"><span>Final total</span><strong>${rupees(total)}</strong></div>
  `;
}

function setFieldError(name, message) {
  const field = checkoutForm.elements[name];
  const error = checkoutForm.querySelector(`[data-error-for="${name}"]`);
  if (field) field.setAttribute("aria-invalid", message ? "true" : "false");
  if (error) error.textContent = message;
}

function validateCheckout() {
  const data = Object.fromEntries(new FormData(checkoutForm));
  const errors = {};
  const required = {
    customer_name: "Full Name is required",
    phone: "Phone Number is required",
    house_flat: "House/Flat No. is required",
    street_area: "Street/Area is required",
    city: "City is required",
    state: "State is required",
    pin_code: "Pincode is required"
  };

  Object.entries(required).forEach(([name, message]) => {
    if (!String(data[name] || "").trim()) errors[name] = message;
  });

  const phoneDigits = String(data.phone || "").replace(/\D/g, "");
  if (data.phone && (phoneDigits.length < 10 || phoneDigits.length > 15)) {
    errors.phone = "Enter a valid phone number";
  }

  if (data.pin_code && !/^\d{6}$/.test(String(data.pin_code).trim())) {
    errors.pin_code = "Enter a valid 6-digit pincode";
  }

  ["customer_name", "phone", "house_flat", "street_area", "landmark", "city", "state", "pin_code", "delivery_instructions"].forEach((name) => {
    setFieldError(name, errors[name] || "");
  });

  return { isValid: Object.keys(errors).length === 0, data };
}

function hydrateForm() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CHECKOUT_DETAILS_KEY) || "{}");
    if (saved.customer_name) checkoutForm.elements.customer_name.value = saved.customer_name;
    if (saved.phone) checkoutForm.elements.phone.value = saved.phone;
    if (saved.order_type) checkoutForm.elements.order_type.value = saved.order_type;
  } catch {
    sessionStorage.removeItem(CHECKOUT_DETAILS_KEY);
  }
}

async function loadMenu() {
  const data = await api("/api/menu");
  state.menu = data.items;
  state.cart = state.cart.filter((cartItem) => state.menu.some((item) => item.id === cartItem.id && item.is_available));
  saveCart();
  renderSummary();
}

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  checkoutStatus.textContent = "";
  const totals = getTotals();
  if (totals.items.length === 0) {
    checkoutStatus.textContent = "Your cart is empty. Add items before placing an order.";
    return;
  }

  const validation = validateCheckout();
  if (!validation.isValid) {
    checkoutStatus.textContent = "Please fix the highlighted fields before placing your order.";
    return;
  }

  const payload = {
    ...validation.data,
    items: state.cart.map(({ id, quantity }) => ({ id, quantity }))
  };

  try {
    const result = await api("/api/orders", { method: "POST", body: JSON.stringify(payload) });
    sessionStorage.setItem(CONFIRMATION_KEY, JSON.stringify({
      orderId: result.orderId,
      placedAt: result.placedAt,
      subtotal: result.subtotal,
      deliveryCharge: result.deliveryCharge,
      tax: result.tax,
      status: result.status,
      total: result.total
    }));
    state.cart = [];
    saveCart();
    sessionStorage.removeItem(CHECKOUT_DETAILS_KEY);
    window.location.href = `/confirmation.html?order=${encodeURIComponent(result.orderId)}`;
  } catch (error) {
    checkoutStatus.textContent = error.message;
  }
});

loadCart();
hydrateForm();
renderSummary();
loadMenu().catch((error) => {
  checkoutStatus.textContent = error.message;
});
