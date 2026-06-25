const state = {
  menu: [],
  cart: []
};

const menuGrid = document.querySelector("#menuGrid");
const categoryFilter = document.querySelector("#categoryFilter");
const cartList = document.querySelector("#cartList");
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
      <button class="btn add-btn" type="button" data-id="${item.id}">Add to Order</button>
    </article>
  `).join("");
}

function renderCart() {
  if (state.cart.length === 0) {
    cartList.textContent = "Select items from the menu.";
    return;
  }
  const total = state.cart.reduce((sum, item) => sum + item.price, 0);
  cartList.innerHTML = state.cart.map((item) => `
    <div class="cart-row"><span>${item.name}</span><strong>${rupees(item.price)}</strong></div>
  `).join("") + `<div class="cart-row"><span>Total</span><strong>${rupees(total)}</strong></div>`;
}

async function loadMenu() {
  const data = await api("/api/menu");
  state.menu = data.items;
  renderCategoryFilter();
  renderMenu();
}

categoryFilter.addEventListener("change", renderMenu);

menuGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  const item = state.menu.find((entry) => entry.id === Number(button.dataset.id));
  if (!item) return;
  state.cart.push(item);
  renderCart();
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
  body.items = state.cart.map(({ id }) => ({ id }));
  try {
    const result = await api("/api/orders", { method: "POST", body: JSON.stringify(body) });
    status.textContent = `Order saved. Total ${rupees(result.total)}.`;
    state.cart = [];
    orderForm.reset();
    renderCart();
  } catch (error) {
    status.textContent = error.message;
  }
});

loadMenu().catch((error) => {
  menuGrid.innerHTML = `<p>${error.message}</p>`;
});
