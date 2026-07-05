import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const defaultDataDir = join(__dirname, "data");
const dbPath = process.env.DB_PATH || join(defaultDataDir, "gaurav-restaurant.sqlite");
const dataDir = dirname(dbPath);
const port = Number(process.env.PORT || 4180);
const adminEmail = process.env.ADMIN_EMAIL || "owner@gauravrestaurant.local";
const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
const sessions = new Map();

if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    price INTEGER NOT NULL,
    is_veg INTEGER NOT NULL DEFAULT 1,
    is_available INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    guests INTEGER NOT NULL,
    reservation_date TEXT NOT NULL,
    reservation_time TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    order_type TEXT NOT NULL,
    items_json TEXT NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

[
  ["order_id", "TEXT"],
  ["house_flat", "TEXT"],
  ["street_area", "TEXT"],
  ["full_address", "TEXT"],
  ["landmark", "TEXT"],
  ["city", "TEXT"],
  ["state", "TEXT"],
  ["pin_code", "TEXT"],
  ["delivery_instructions", "TEXT"],
  ["subtotal", "INTEGER"],
  ["delivery_charge", "INTEGER"],
  ["tax", "INTEGER"],
  ["final_total", "INTEGER"],
  ["placed_at", "TEXT"],
  ["status_updated_at", "TEXT"],
  ["deleted_at", "TEXT"]
].forEach(([column, definition]) => ensureColumn("orders", column, definition));

const count = db.prepare("SELECT COUNT(*) AS count FROM menu_items").get().count;
if (count === 0) {
  const seed = db.prepare(`
    INSERT INTO menu_items (name, category, description, price, is_veg, is_available)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  [
    ["Paneer Tikka", "Starters", "Smoky tandoor paneer with mint chutney.", 249, 1, 1],
    ["Crispy Corn Chaat", "Starters", "Corn, onion, coriander, lime, and house masala.", 179, 1, 1],
    ["Butter Chicken", "Main Course", "Creamy tomato gravy with tender chicken pieces.", 389, 0, 1],
    ["Dal Makhani", "Main Course", "Slow-cooked black lentils finished with butter.", 269, 1, 1],
    ["Veg Biryani", "Rice & Biryani", "Fragrant basmati rice, vegetables, saffron, and raita.", 299, 1, 1],
    ["Chicken Biryani", "Rice & Biryani", "Dum-cooked chicken biryani with salan and raita.", 349, 0, 1],
    ["Gulab Jamun", "Desserts", "Warm khoya dumplings in cardamom syrup.", 129, 1, 1],
    ["Masala Soda", "Drinks", "Sparkling lime soda with roasted spices.", 99, 1, 1]
  ].forEach((item) => seed.run(...item));
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const deliveryCharge = 49;
const taxRate = 0.05;
const orderStatuses = ["Pending", "Accepted", "Preparing", "Ready", "Out for Delivery", "Delivered", "Cancelled"];

db.prepare("UPDATE orders SET status = ? WHERE LOWER(status) IN (?, ?)").run("Pending", "new", "pending");

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function safeEquals(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

function currentAdmin(req) {
  const sessionId = parseCookies(req).gr_admin_session;
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { email: session.email };
}

function requireAdmin(req, res) {
  const admin = currentAdmin(req);
  if (admin) return admin;
  sendJson(res, 401, { error: "Admin login required" });
  return null;
}

function setSessionCookie(res, sessionId) {
  res.setHeader(
    "set-cookie",
    `gr_admin_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
  );
}

function clearSessionCookie(res) {
  res.setHeader("set-cookie", "gr_admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  return JSON.parse(raw);
}

function menuRows() {
  return db
    .prepare("SELECT * FROM menu_items ORDER BY category, name")
    .all()
    .map((item) => ({
      ...item,
      is_veg: Boolean(item.is_veg),
      is_available: Boolean(item.is_available)
    }));
}

function validateText(value, label, min = 1) {
  const text = String(value || "").trim();
  if (text.length < min) throw new Error(`${label} is required`);
  return text;
}

function validatePhone(value) {
  const phone = validateText(value, "Phone Number", 8);
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) throw new Error("Enter a valid phone number");
  return phone;
}

function validatePinCode(value) {
  const pinCode = validateText(value, "Pincode", 6);
  if (!/^\d{6}$/.test(pinCode)) throw new Error("Enter a valid 6-digit pincode");
  return pinCode;
}

function generateOrderId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `GR-${stamp}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function validateOrderStatus(value) {
  const status = String(value || "").trim();
  if (!orderStatuses.includes(status)) throw new Error("Invalid order status");
  return status;
}

function orderRows(where = "deleted_at IS NULL") {
  return db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY COALESCE(placed_at, created_at) DESC`).all().map((order) => ({
    ...order,
    items: parseOrderItems(order.items_json)
  }));
}

function parseOrderItems(value) {
  try {
    const items = JSON.parse(value || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function orderDate(order) {
  return new Date(order.placed_at || order.created_at);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfWeek() {
  const today = startOfToday();
  const day = today.getDay() || 7;
  today.setDate(today.getDate() - day + 1);
  return today;
}

function dashboardRange(filter) {
  const now = new Date();
  if (filter === "today") {
    const start = startOfToday();
    return { key: "today", start, end: now };
  }
  if (filter === "week") {
    return { key: "week", start: startOfWeek(), end: now };
  }
  if (filter === "month") {
    return { key: "month", start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  }
  return { key: "all", start: null, end: now };
}

function dateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateLabel(key) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(new Date(`${key}T00:00:00`));
}

function orderAmount(order) {
  return Number(order.final_total || order.total || 0);
}

function isRevenueOrder(order) {
  return order.status === "Delivered";
}

function buildDashboard(filter) {
  const range = dashboardRange(filter);
  const allOrders = orderRows("deleted_at IS NULL");
  const inRange = allOrders.filter((order) => {
    if (!range.start) return true;
    const date = orderDate(order);
    return date >= range.start && date <= range.end;
  });
  const todayStart = startOfToday();
  const todayOrders = allOrders.filter((order) => orderDate(order) >= todayStart);
  const revenueOrders = inRange.filter(isRevenueOrder);
  const todayRevenueOrders = todayOrders.filter(isRevenueOrder);
  const chartMap = new Map();
  const topItems = new Map();

  inRange.forEach((order) => {
    const key = dateKey(orderDate(order));
    const day = chartMap.get(key) || { date: key, label: dateLabel(key), orders: 0, revenue: 0 };
    day.orders += 1;
    if (isRevenueOrder(order)) day.revenue += orderAmount(order);
    chartMap.set(key, day);

    if (order.status !== "Cancelled") {
      order.items.forEach((item) => {
        const id = item.id || item.name;
        const current = topItems.get(id) || { id, name: item.name, quantity: 0, revenue: 0 };
        const quantity = Number(item.quantity || 1);
        current.quantity += quantity;
        current.revenue += Number(item.line_total || item.price * quantity || 0);
        topItems.set(id, current);
      });
    }
  });

  return {
    filter: range.key,
    summary: {
      totalOrders: inRange.length,
      todaysOrders: todayOrders.length,
      pendingOrders: inRange.filter((order) => order.status === "Pending").length,
      deliveredOrders: inRange.filter((order) => order.status === "Delivered").length,
      cancelledOrders: inRange.filter((order) => order.status === "Cancelled").length,
      totalRevenue: revenueOrders.reduce((sum, order) => sum + orderAmount(order), 0),
      todayRevenue: todayRevenueOrders.reduce((sum, order) => sum + orderAmount(order), 0)
    },
    recentOrders: inRange.slice(0, 5),
    topItems: [...topItems.values()]
      .sort((left, right) => right.quantity - left.quantity || right.revenue - left.revenue)
      .slice(0, 5),
    charts: [...chartMap.values()].sort((left, right) => left.date.localeCompare(right.date))
  };
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      return sendJson(res, 200, { admin: currentAdmin(req) });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJson(req);
      const email = validateText(body.email, "Email", 3).toLowerCase();
      const password = String(body.password || "");
      if (!safeEquals(email, adminEmail.toLowerCase()) || !safeEquals(password, adminPassword)) {
        return sendJson(res, 401, { error: "Wrong email or password" });
      }
      const sessionId = randomBytes(32).toString("hex");
      sessions.set(sessionId, { email: adminEmail, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
      setSessionCookie(res, sessionId);
      return sendJson(res, 200, { ok: true, admin: { email: adminEmail } });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const sessionId = parseCookies(req).gr_admin_session;
      if (sessionId) sessions.delete(sessionId);
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/menu") {
      return sendJson(res, 200, { items: menuRows() });
    }

    if (req.method === "POST" && url.pathname === "/api/menu") {
      if (!requireAdmin(req, res)) return;
      const body = await readJson(req);
      const name = validateText(body.name, "Item name", 2);
      const category = validateText(body.category, "Category", 2);
      const description = validateText(body.description, "Description", 3);
      const price = Number(body.price);
      if (!Number.isInteger(price) || price < 1) throw new Error("Valid price is required");
      db.prepare(`
        INSERT INTO menu_items (name, category, description, price, is_veg, is_available)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(name, category, description, price, body.is_veg ? 1 : 0, body.is_available === false ? 0 : 1);
      return sendJson(res, 201, { items: menuRows() });
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/menu/")) {
      if (!requireAdmin(req, res)) return;
      const id = Number(url.pathname.split("/").pop());
      const body = await readJson(req);
      if (!Number.isInteger(id)) throw new Error("Invalid menu item");
      db.prepare(`
        UPDATE menu_items
        SET name = ?, category = ?, description = ?, price = ?, is_veg = ?, is_available = ?
        WHERE id = ?
      `).run(
        validateText(body.name, "Item name", 2),
        validateText(body.category, "Category", 2),
        validateText(body.description, "Description", 3),
        Number(body.price),
        body.is_veg ? 1 : 0,
        body.is_available ? 1 : 0,
        id
      );
      return sendJson(res, 200, { items: menuRows() });
    }

    if (req.method === "GET" && url.pathname === "/api/reservations") {
      if (!requireAdmin(req, res)) return;
      const rows = db.prepare("SELECT * FROM reservations ORDER BY created_at DESC").all();
      return sendJson(res, 200, { reservations: rows });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/dashboard") {
      if (!requireAdmin(req, res)) return;
      return sendJson(res, 200, buildDashboard(url.searchParams.get("filter")));
    }

    if (req.method === "POST" && url.pathname === "/api/reservations") {
      const body = await readJson(req);
      const guests = Number(body.guests);
      if (!Number.isInteger(guests) || guests < 1 || guests > 20) throw new Error("Guests must be between 1 and 20");
      db.prepare(`
        INSERT INTO reservations (customer_name, phone, guests, reservation_date, reservation_time, note)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        validateText(body.customer_name, "Name", 2),
        validateText(body.phone, "Phone", 8),
        guests,
        validateText(body.reservation_date, "Date"),
        validateText(body.reservation_time, "Time"),
        String(body.note || "").trim()
      );
      return sendJson(res, 201, { ok: true, message: "Reservation request saved" });
    }

    if (req.method === "GET" && url.pathname === "/api/orders") {
      if (!requireAdmin(req, res)) return;
      return sendJson(res, 200, { orders: orderRows("deleted_at IS NULL") });
    }

    if (req.method === "GET" && url.pathname === "/api/orders/trash") {
      if (!requireAdmin(req, res)) return;
      return sendJson(res, 200, { orders: orderRows("deleted_at IS NOT NULL") });
    }

    if (req.method === "GET" && url.pathname === "/api/order-status") {
      const orderId = validateText(url.searchParams.get("orderId"), "Order ID", 6);
      const order = db.prepare(`
        SELECT order_id, status, placed_at, COALESCE(status_updated_at, placed_at, created_at) AS status_updated_at
        FROM orders
        WHERE order_id = ? AND deleted_at IS NULL
      `).get(orderId);
      if (!order) throw new Error("Order not found");
      return sendJson(res, 200, { order, statuses: orderStatuses });
    }

    if (req.method === "PATCH" && url.pathname.endsWith("/restore") && url.pathname.startsWith("/api/orders/")) {
      if (!requireAdmin(req, res)) return;
      const id = Number(url.pathname.split("/").at(-2));
      if (!Number.isInteger(id)) throw new Error("Invalid order");
      const result = db.prepare("UPDATE orders SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL").run(id);
      if (result.changes === 0) throw new Error("Order not found in trash");
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && url.pathname.endsWith("/permanent") && url.pathname.startsWith("/api/orders/")) {
      if (!requireAdmin(req, res)) return;
      const id = Number(url.pathname.split("/").at(-2));
      if (!Number.isInteger(id)) throw new Error("Invalid order");
      const result = db.prepare("DELETE FROM orders WHERE id = ? AND deleted_at IS NOT NULL").run(id);
      if (result.changes === 0) throw new Error("Order not found in trash");
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/orders/")) {
      if (!requireAdmin(req, res)) return;
      const id = Number(url.pathname.split("/").pop());
      if (!Number.isInteger(id)) throw new Error("Invalid order");
      const body = await readJson(req);
      const status = validateOrderStatus(body.status);
      const updatedAt = new Date().toISOString();
      const result = db.prepare("UPDATE orders SET status = ?, status_updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(status, updatedAt, id);
      if (result.changes === 0) throw new Error("Order not found");
      return sendJson(res, 200, { ok: true, status, statusUpdatedAt: updatedAt });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/orders/")) {
      if (!requireAdmin(req, res)) return;
      const id = Number(url.pathname.split("/").pop());
      if (!Number.isInteger(id)) throw new Error("Invalid order");
      const result = db.prepare("UPDATE orders SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").run(new Date().toISOString(), id);
      if (result.changes === 0) throw new Error("Order not found");
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/orders") {
      const body = await readJson(req);
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) throw new Error("Cart is empty");
      const customerName = validateText(body.customer_name || body.full_name, "Customer Name", 2);
      const phone = validatePhone(body.phone);
      const houseFlat = validateText(body.house_flat, "House/Flat No.", 1);
      const streetArea = validateText(body.street_area, "Street/Area", 3);
      const city = validateText(body.city, "City", 2);
      const state = validateText(body.state, "State", 2);
      const pinCode = validatePinCode(body.pin_code);
      const landmark = String(body.landmark || "").trim();
      const deliveryInstructions = String(body.delivery_instructions || "").trim();
      const fullAddress = [houseFlat, streetArea, landmark, city, state, pinCode].filter(Boolean).join(", ");
      const orderId = generateOrderId();
      const placedAt = new Date().toISOString();
      const menu = new Map(menuRows().map((item) => [item.id, item]));
      const quantities = new Map();
      items.forEach((item) => {
        const id = Number(item.id);
        const quantity = Number(item.quantity || 1);
        if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 1) return;
        quantities.set(id, (quantities.get(id) || 0) + quantity);
      });
      const safeItems = [...quantities.entries()]
        .map(([id, quantity]) => {
          const item = menu.get(id);
          if (!item || !item.is_available) return null;
          return { id: item.id, name: item.name, price: item.price, quantity, line_total: item.price * quantity };
        })
        .filter(Boolean);
      if (safeItems.length === 0) throw new Error("Valid items are required");
      const subtotal = safeItems.reduce((sum, item) => sum + item.line_total, 0);
      const tax = Math.round(subtotal * taxRate);
      const finalTotal = subtotal + deliveryCharge + tax;
      db.prepare(`
        INSERT INTO orders (
          order_id, customer_name, phone, order_type, items_json, subtotal, delivery_charge, tax, total,
          final_total, house_flat, street_area, full_address, landmark, city, state, pin_code, delivery_instructions, placed_at, status_updated_at, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderId,
        customerName,
        phone,
        body.order_type === "delivery" ? "delivery" : "pickup",
        JSON.stringify(safeItems),
        subtotal,
        deliveryCharge,
        tax,
        finalTotal,
        finalTotal,
        houseFlat,
        streetArea,
        fullAddress,
        landmark,
        city,
        state,
        pinCode,
        deliveryInstructions,
        placedAt,
        placedAt,
        "Pending"
      );
      return sendJson(res, 201, {
        ok: true,
        message: "Order saved",
        orderId,
        placedAt,
        subtotal,
        deliveryCharge,
        tax,
        status: "Pending",
        statusUpdatedAt: placedAt,
        total: finalTotal
      });
    }

    return sendJson(res, 404, { error: "API route not found" });
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Something went wrong" });
  }
}

async function serveStatic(req, res, url) {
  if (url.pathname === "/admin") {
    res.writeHead(302, { location: currentAdmin(req) ? "/admin.html" : "/login.html" });
    res.end();
    return;
  }

  if ((url.pathname === "/admin.html" || url.pathname === "/trash.html") && !currentAdmin(req)) {
    res.writeHead(302, { location: "/login.html" });
    res.end();
    return;
  }

  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalized = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, normalized);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
}).listen(port, () => {
  console.log(`Gaurav Restaurant app running at http://127.0.0.1:${port}`);
  console.log(`Admin login: ${adminEmail}`);
  console.log(`Database: ${dbPath}`);
});
