const state = {
  menu: [],
  cart: []
};

const CART_STORAGE_KEY = "gauravRestaurantCart";

const menuGrid = document.querySelector("#menuGrid");
const categoryFilter = document.querySelector("#categoryFilter");
const cartList = document.querySelector("#cartList");
const cartCount = document.querySelector("#cartCount");
const bookingForm = document.querySelector("#booking");
const orderForm = document.querySelector("#order");

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

function saveCart() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
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

function getCartDetails() {
  return state.cart
    .map((cartItem) => {
      const menuItem = state.menu.find((item) => item.id === cartItem.id);
      if (!menuItem) return null;
      return { ...menuItem, quantity: cartItem.quantity, lineTotal: menuItem.price * cartItem.quantity };
    })
    .filter(Boolean);
}

function updateCartCount() {
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  cartCount.textContent = count;
}

function setCartItem(id, quantity) {
  const item = state.cart.find((entry) => entry.id === id);
  if (quantity <= 0) {
    state.cart = state.cart.filter((entry) => entry.id !== id);
  } else if (item) {
    item.quantity = quantity;
  } else {
    state.cart.push({ id, quantity });
  }
  saveCart();
  renderCart();
}

function renderCategoryFilter() {
  const categories = [...new Set(state.menu.map((item) => item.category))];
  categoryFilter.innerHTML = `<option value="all">All categories</option>`;
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categoryFilter.append(option);
  });
}

function renderMenu() {
  const category = categoryFilter.value || "all";
  const items = state.menu.filter((item) => item.is_available && (category === "all" || item.category === category));
  menuGrid.innerHTML = items.map((item) => `
    <article class="menu-card">
      <div>
        <span class="pill ${item.is_veg ? "" : "nonveg"}">${item.is_veg ? "Veg" : "Non-veg"}</span>
        <h3>${item.name}</h3>
        <p>${item.description}</p>
      </div>
      <div class="menu-meta">
        <span>${item.category}</span>
        <span class="price">${rupees(item.price)}</span>
      </div>
      <button class="btn add-btn" type="button" data-id="${item.id}">Add to Cart</button>
    </article>
  `).join("");
}

function renderCart() {
  updateCartCount();
  const items = getCartDetails();
  if (items.length === 0) {
    cartList.textContent = "Your cart is empty";
    return;
  }

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  cartList.innerHTML = items.map((item) => `
    <div class="cart-row">
      <div class="cart-item">
        <strong>${item.name}</strong>
        <span>${rupees(item.price)} each</span>
      </div>
      <div class="cart-controls" aria-label="${item.name} quantity controls">
        <button type="button" data-cart-action="decrease" data-id="${item.id}" aria-label="Decrease ${item.name} quantity">-</button>
        <span>${item.quantity}</span>
        <button type="button" data-cart-action="increase" data-id="${item.id}" aria-label="Increase ${item.name} quantity">+</button>
      </div>
      <strong>${rupees(item.lineTotal)}</strong>
      <button class="cart-remove" type="button" data-cart-action="remove" data-id="${item.id}">Remove</button>
    </div>
  `).join("") + `
    <div class="cart-summary"><span>Subtotal</span><strong>${rupees(subtotal)}</strong></div>
    <div class="cart-summary total"><span>Total</span><strong>${rupees(subtotal)}</strong></div>
  `;
}

async function loadMenu() {
  const data = await api("/api/menu");
  state.menu = data.items;
  state.cart = state.cart.filter((cartItem) => state.menu.some((item) => item.id === cartItem.id && item.is_available));
  saveCart();
  renderCategoryFilter();
  renderMenu();
  renderCart();
}

categoryFilter.addEventListener("change", renderMenu);

menuGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  const item = state.menu.find((entry) => entry.id === Number(button.dataset.id));
  if (!item) return;
  const cartItem = state.cart.find((entry) => entry.id === item.id);
  setCartItem(item.id, cartItem ? cartItem.quantity + 1 : 1);
});

cartList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-cart-action]");
  if (!button) return;
  const id = Number(button.dataset.id);
  const cartItem = state.cart.find((entry) => entry.id === id);
  if (!cartItem) return;
  if (button.dataset.cartAction === "increase") setCartItem(id, cartItem.quantity + 1);
  if (button.dataset.cartAction === "decrease") setCartItem(id, cartItem.quantity - 1);
  if (button.dataset.cartAction === "remove") setCartItem(id, 0);
});

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#bookingStatus");
  const body = Object.fromEntries(new FormData(bookingForm));
  try {
    await api("/api/reservations", { method: "POST", body: JSON.stringify(body) });
    status.textContent = "Booking request saved. Restaurant team can see it in admin.";
    bookingForm.reset();
  } catch (error) {
    status.textContent = error.message;
  }
});

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#orderStatus");
  const body = Object.fromEntries(new FormData(orderForm));
  body.items = state.cart.map(({ id, quantity }) => ({ id, quantity }));
  try {
    const result = await api("/api/orders", { method: "POST", body: JSON.stringify(body) });
    status.textContent = `Order saved. Total ${rupees(result.total)}.`;
    state.cart = [];
    saveCart();
    orderForm.reset();
    renderCart();
  } catch (error) {
    status.textContent = error.message;
  }
});

loadCart();
renderCart();
loadMenu().catch((error) => {
  menuGrid.innerHTML = `<p>${error.message}</p>`;
});
