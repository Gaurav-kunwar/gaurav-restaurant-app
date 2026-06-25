# Gaurav Restaurant App

Full-stack restaurant starter for Gaurav Restaurant.

## What is included

- Customer website with hero, live menu, booking form, and pickup/delivery order form.
- Backend API built with Node.js.
- SQLite database stored at `data/gaurav-restaurant.sqlite`.
- Password-protected admin dashboard at `/admin.html` for menu, reservations, and orders.
- No external npm dependencies for the first working version.

## Run locally

```powershell
cd C:\Users\Gaura\Documents\Codex\2026-06-25\mak\outputs\gaurav-restaurant-app
npm.cmd start
```

Open:

- Website: `http://127.0.0.1:4180/`
- Admin entry: `http://127.0.0.1:4180/admin`
- Admin dashboard after login: `http://127.0.0.1:4180/admin.html`
- Login: `owner@gauravrestaurant.local` / `admin123`

For production, set a stronger password before starting the server:

```powershell
$env:ADMIN_EMAIL="owner@example.com"
$env:ADMIN_PASSWORD="use-a-strong-password-here"
npm.cmd start
```

## API routes

- `GET /api/menu`
- `POST /api/menu` admin only
- `GET /api/reservations` admin only
- `POST /api/reservations`
- `GET /api/orders` admin only
- `POST /api/orders`

## Deployment path

This local version uses SQLite, which is good for local testing and a small private server.

For a public production app, the recommended upgrade is:

- Frontend/backend hosting: Render, Railway, Fly.io, or a VPS.
- Database: Supabase Postgres, Neon Postgres, or Railway Postgres.
- Admin login: included for the local server; use strong environment variables in production.
- Payments: Razorpay.
- Notifications: WhatsApp Business API, Twilio, or email service.

## Info still needed

- Real restaurant address and Google Maps link.
- Public phone number and WhatsApp number.
- Final menu, prices, categories, and food photos.
- Logo and color preference.
- Delivery or pickup rules.
- Whether admin should be Hindi, English, or both.
