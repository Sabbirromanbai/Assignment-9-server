# 🍕 Pizzabari API — Backend Server

REST API for the **Pizzabari** pizza ordering platform. It powers authentication, role-based dashboards (Customer / Vendor / Admin), menu and order management, and Stripe-powered Premium subscriptions for vendors.

## 🔗 Links

- **Live Website:** https://assignment-9-client-nine.vercel.app/
- **Client Repository:** https://github.com/Sabbirromanbai/Assignment-9-client
- **Server Repository:** https://github.com/Sabbirromanbai/Assignment-9-server

## ✨ Features

- **Authentication with Better Auth** — email/password sign-up with role selection (Customer or Vendor, never Admin) and password rules, plus Google OAuth
- New Google users get a one-time, server-enforced **role choice** (`roleSelectionPending` flag + `POST /api/profile/choose-role`); roles cannot be changed afterwards
- **Stateless authorization** — API requests carry a JWT that is verified against the auth server's JWKS endpoint; role middleware guards every protected route, and blocked users are rejected
- **Menu management** — vendors create/edit/delete items with image upload (ImgBB); free plan is limited to 3 active items; admins moderate (approve/reject) submitted items
- **Public menu browsing** with search, category & location filters, and price sorting
- **Orders** — customers order for a specific delivery date; a customer cannot place two active orders for the same item on the same date (enforced both in code and by a partial unique index)
- **Stripe subscriptions** — Premium checkout, cancellation, and webhook-verified activation/expiry for vendors
- **Dashboards with chart data** — 30 days of daily orders per customer/vendor, vendor orders by category, and daily platform revenue for the admin
- **Admin tools** — user search, block/unblock, and a read-only transaction list with vendor names

## 🛠️ Tech Stack

| Technology            | Purpose                                  |
| --------------------- | ---------------------------------------- |
| Node.js + Express 5   | HTTP server and routing                  |
| MongoDB (native driver) | Database                               |
| Better Auth           | Authentication, sessions, JWT issuing    |
| jose                  | JWKS-based JWT verification              |
| Stripe                | Premium subscription payments + webhooks |
| ImgBB                 | Menu/profile image hosting               |

## 🚀 Getting Started

### Prerequisites

- Node.js **>= 20**
- A MongoDB database (e.g. MongoDB Atlas)
- A Stripe account and an ImgBB API key (for full functionality)

### Installation

```bash
# Clone the repository
git clone https://github.com/Sabbirromanbai/Assignment-9-server.git
cd Assignment-9-server

# Install dependencies
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:3000

MONGODB_URI=your_mongodb_connection_string
DB_NAME=your_database_name

BETTER_AUTH_SECRET=your_auth_secret
BETTER_AUTH_URL=http://localhost:5000

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
STRIPE_PREMIUM_PRICE_ID=your_stripe_price_id

IMGBB_API_KEY=your_imgbb_api_key
```

> Never commit your real `.env` file — it contains database and payment secrets.

### Run the Server

```bash
# Start the server
node index.js

# Run the test suite
npm test
```

The API runs at `http://localhost:5000` by default.

## 📡 API Overview

Authentication endpoints are served by Better Auth under `/api/auth/*`.

| Area         | Endpoints                                                                 |
| ------------ | ------------------------------------------------------------------------- |
| Menu (public) | `GET /api/menu` (search / filter / sort), `GET /api/vendors/:id` (public vendor profile) |
| Menu (vendor) | `GET /api/menu/mine`, `POST /api/menu`, `PUT /api/menu/:id`, availability toggle, `DELETE /api/menu/:id` |
| Menu (admin)  | `GET /api/menu/admin`, `GET /api/menu/admin/pending`, `PATCH /api/menu/admin/:id/status`, `DELETE /api/menu/admin/:id` |
| Orders        | `POST /api/orders`, `GET /api/orders/mine`, `PATCH /api/orders/:id`, `PATCH /api/orders/:id/cancel` |
| Dashboards    | `GET /api/customers/dashboard`, `GET /api/vendors/dashboard`, `GET /api/admin/dashboard` |
| Vendor profile | `GET /api/vendors/profile`, `PATCH /api/vendors/profile`                 |
| Profile       | `POST /api/profile/choose-role`, profile image upload endpoints            |
| Admin         | `GET /api/admin/users`, `PATCH /api/admin/users/:id/block`, `GET /api/admin/transactions` |
| Subscriptions | `POST /api/subscriptions/checkout`, `POST /api/subscriptions/cancel`, `POST /api/subscriptions/webhook` |

## 🧩 Implementation Notes

- **Duplicate-order rule:** the check and the database index are scoped per customer — `{ customerId, itemId, deliveryDate }` with a partial filter on active (`pending`/`accepted`) orders — so one customer cannot double-book an item for a date, while different customers can still order the same item for the same date.
- **JWT verification:** protected routes verify the Bearer token with `jose` against the Better Auth JWKS endpoint (issuer and audience pinned to the backend URL), then load the user to enforce role and blocked-status checks.
- **Stripe webhooks are the source of truth** for Premium: a subscription becomes active only after the webhook confirms payment, and cancellation/expiry are handled from webhook events — never from the browser redirect alone.
- **Server-controlled fields:** role changes, blocking, and subscription fields are marked `input: false` in Better Auth or guarded in middleware, so clients cannot set them directly.

## 👨‍💻 Author

**Sabbir Roman**

- GitHub: https://github.com/Sabbirromanbai
- Portfolio: https://my-protfolio-bice-chi.vercel.app/
- LinkedIn: https://www.linkedin.com/in/md-sabbir-hossen-9000593b6/
