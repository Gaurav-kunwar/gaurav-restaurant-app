import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const dataDir = join(__dirname, "data");
const dbPath = join(dataDir, "gaurav-restaurant.sqlite");
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
    status TEXT NOT NULL DEFAULT 'new',
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
  ["placed_at", "TEXT"]
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
  const pinCode = validateText(value, "PIN Code", 6);
  if (!/^\d{6}$/.test(pinCode)) throw new Error("Enter a valid 6-digit PIN Code");
  return pinCode;
}

function generateOrderId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `GR-${stamp}-${randomBytes(3).toString("hex").toUpperCase()}`;
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
      const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all().map((order) => ({
        ...order,
        items: JSON.parse(order.items_json)
      }));
      return sendJson(res, 200, { orders: rows });
    }

    if (req.method === "POST" && url.pathname === "/api/orders") {
      const body = await readJson(req);
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) throw new Error("Cart is empty");
      const customerName = validateText(body.customer_name || body.full_name, "Customer Full Name", 2);
      const phone = validatePhone(body.phone);
      const fullAddress = validateText(body.full_address, "Full Delivery Address", 8);
      const city = validateText(body.city, "City", 2);
      const stateName = validateText(body.state, "State", 2);
      const pinCode = validatePinCode(body.pin_code);
      const landmark = String(body.landmark || "").trim();
      const deliveryInstructions = String(body.delivery_instructions || "").trim();
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
          final_total, full_address, landmark, city, state, pin_code, delivery_instructions, placed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        fullAddress,
        landmark,
        city,
        stateName,
        pinCode,
        deliveryInstructions,
        placedAt
      );
      return sendJson(res, 201, {
        ok: true,
        message: "Order saved",
        orderId,
        placedAt,
        subtotal,
        deliveryCharge,
        tax,
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

  if (url.pathname === "/admin.html" && !currentAdmin(req)) {
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
