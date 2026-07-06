import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 5400 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const tmp = await mkdtemp(join(tmpdir(), "gr-dashboard-"));
const dbPath = join(tmp, "test.sqlite");
let server;
let smtpServer;
const smtpMessages = [];

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return { data, response };
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await request("/api/menu");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Server did not start in time");
}

async function createOrder(itemId, quantity, name) {
  const { data } = await request("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      customer_name: name,
      customer_email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      phone: "9876543210",
      order_type: "delivery",
      house_flat: "12A",
      street_area: "MG Road",
      city: "Bengaluru",
      state: "Karnataka",
      pin_code: "560001",
      items: [{ id: itemId, quantity }]
    })
  });
  return data;
}

function startSmtpServer() {
  return new Promise((resolve, reject) => {
    const listener = createNetServer((socket) => {
      let dataMode = false;
      let message = "";
      socket.setEncoding("utf8");
      socket.write("220 local test smtp\r\n");

      socket.on("data", (chunk) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line && !dataMode) continue;
          if (dataMode) {
            if (line === ".") {
              smtpMessages.push(message);
              message = "";
              dataMode = false;
              socket.write("250 queued\r\n");
            } else {
              message += `${line}\n`;
            }
            continue;
          }

          const command = line.toUpperCase();
          if (command.startsWith("EHLO") || command.startsWith("HELO")) {
            socket.write("250-localhost\r\n250 AUTH PLAIN LOGIN\r\n");
          } else if (command.startsWith("AUTH")) {
            socket.write("235 authenticated\r\n");
          } else if (command.startsWith("MAIL FROM") || command.startsWith("RCPT TO")) {
            socket.write("250 ok\r\n");
          } else if (command.startsWith("DATA")) {
            dataMode = true;
            socket.write("354 end with dot\r\n");
          } else if (command.startsWith("RSET")) {
            socket.write("250 reset\r\n");
          } else if (command.startsWith("QUIT")) {
            socket.write("221 bye\r\n");
            socket.end();
          } else {
            socket.write("250 ok\r\n");
          }
        }
      });
    });
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => resolve(listener));
  });
}

try {
  smtpServer = await startSmtpServer();
  const smtpPort = smtpServer.address().port;

  server = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      ADMIN_EMAIL: "owner@example.com",
      SMTP_HOST: " 127.0.0.1 ",
      SMTP_PORT: ` ${smtpPort} `,
      SMTP_USER: " sender@example.com ",
      SMTP_PASS: " test-password ",
      EMAIL_AWAIT_SEND: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  server.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  server.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  await waitForServer();

  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "owner@example.com",
      password: "admin123"
    })
  });
  const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "admin login should return a session cookie");
  const adminHeaders = { cookie };

  const { data: menu } = await request("/api/menu");
  const paneer = menu.items.find((item) => item.name === "Paneer Tikka");
  const chickenBiryani = menu.items.find((item) => item.name === "Chicken Biryani");
  const butterChicken = menu.items.find((item) => item.name === "Butter Chicken");
  assert.ok(paneer && chickenBiryani && butterChicken, "seed menu items should exist");

  const delivered = await createOrder(paneer.id, 2, "Delivered Customer");
  const cancelled = await createOrder(butterChicken.id, 1, "Cancelled Customer");
  const pending = await createOrder(chickenBiryani.id, 3, "Pending Customer");

  const { data: ordersData } = await request("/api/orders", { headers: adminHeaders });
  assert.equal(ordersData.orders.length, 3);
  const ordersByPublicId = new Map(ordersData.orders.map((order) => [order.order_id, order]));

  await request(`/api/orders/${ordersByPublicId.get(delivered.orderId).id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "Delivered" })
  });
  await request(`/api/orders/${ordersByPublicId.get(cancelled.orderId).id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "Cancelled" })
  });

  const { data: dashboard } = await request("/api/admin/dashboard?filter=today", { headers: adminHeaders });

  assert.equal(dashboard.summary.totalOrders, 3);
  assert.equal(dashboard.summary.todaysOrders, 3);
  assert.equal(dashboard.summary.pendingOrders, 1);
  assert.equal(dashboard.summary.deliveredOrders, 1);
  assert.equal(dashboard.summary.cancelledOrders, 1);
  assert.equal(dashboard.summary.totalRevenue, delivered.total);
  assert.equal(dashboard.summary.todayRevenue, delivered.total);
  assert.equal(dashboard.recentOrders.length, 3);
  assert.ok(dashboard.recentOrders.some((order) => order.order_id === pending.orderId));
  assert.equal(dashboard.topItems[0].name, "Chicken Biryani");
  assert.equal(dashboard.topItems[0].quantity, 3);
  assert.ok(dashboard.charts.some((point) => point.orders === 3 && point.revenue === delivered.total));

  const emailTest = await request("/api/admin/email-test", { method: "POST", headers: adminHeaders });
  assert.equal(emailTest.data.ok, true);
  assert.match(emailTest.data.message, /owner@example\.com/);

  for (const filter of ["week", "month", "all"]) {
    const { data } = await request(`/api/admin/dashboard?filter=${filter}`, { headers: adminHeaders });
    assert.equal(data.filter, filter);
    assert.equal(data.summary.totalOrders, 3);
  }

  assert.match(stdout, /\[email\] admin order notification sent/);
  assert.match(stdout, /\[email\] customer order confirmation sent/);
  assert.match(stdout, /\[email\] admin test email sent/);
  assert.equal(smtpMessages.length, 7);
  assert.ok(smtpMessages.some((message) => message.includes("Gaurav Restaurant test email")));
  assert.ok(smtpMessages.some((message) => message.includes("New order received at Gaurav Restaurant")));
  assert.ok(smtpMessages.some((message) => message.includes("Thank you for your order")));

  console.log("Dashboard analytics and email smoke test passed");
} finally {
  if (server && !server.killed) server.kill();
  if (smtpServer) smtpServer.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await rm(tmp, { recursive: true, force: true });
}
