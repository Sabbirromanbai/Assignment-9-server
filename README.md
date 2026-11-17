# PizzaHub Server

PizzaHub is an Express API for a role-based pizza menu and ordering platform. It uses Better Auth with MongoDB, the MongoDB Native Driver, ImgBB for menu images, and Stripe Checkout for vendor Premium subscriptions.

## Features

- Better Auth email/password and optional Google OAuth, with JWT verification and server-side role checks.
- Customer, vendor, and admin access control; blocked users are rejected by protected APIs.
- Vendor menu management, ImgBB image uploads, admin review, and approved-only public listings.
- Free vendors may have up to three approved (active) menu items. Pending, rejected, and inactive items do not count as active. Premium is unlimited while its verified subscription is active.
- Customer orders and vendor order management with ownership checks.
- Stripe Checkout and signed webhooks for Premium subscription activation, cancellation, and expiration.
- Admin user management, platform counts, and read-only transaction listing.

## Technology

- Node.js, Express 5, JavaScript ES Modules
- MongoDB Native Driver
- Better Auth, MongoDB adapter, JWT
- Stripe SDK
- ImgBB API

## Run locally

1. Install dependencies with `npm install`.
2. Set the environment variables listed below.
3. Start the server with `node index.js`.

The server defaults to port `5000`.

## Environment variable names

Required for database and authentication configuration:

- `MONGODB_URI`
- `DB_NAME`
- `BETTER_AUTH_URL`

Set `BETTER_AUTH_SECRET` to a stable secret in deployed environments. Set `CLIENT_URL` to the frontend origin; the local fallback is `http://localhost:3000`.

Required only for the corresponding integrations:

- `IMGBB_API_KEY` — menu image uploads.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PREMIUM_PRICE_ID` — Premium subscription checkout and webhooks.

Optional:

- `PORT`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Never commit `.env` files or secret values. Google sign-in is enabled only when both Google variables are provided. Stripe Checkout requires a recurring Premium price configured in Stripe. Configure the Stripe webhook destination as `/api/subscriptions/webhook` and subscribe to `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `customer.subscription.updated`, and `customer.subscription.deleted`.

## API

Better Auth endpoints are mounted under `/api/auth`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/menu` | Public | Approved menu; accepts `search`, `category`, `location`, and `sort=newest\|price_asc\|price_desc` |
| `POST` | `/api/menu` | Vendor | Create a pending menu item |
| `GET` | `/api/menu/mine` | Vendor | List own menu items |
| `PUT` | `/api/menu/:id` | Owning vendor | Update an item; changes return it to pending review |
| `PATCH` | `/api/menu/:id/availability` | Owning vendor | Deactivate or request reapproval |
| `DELETE` | `/api/menu/:id` | Owning vendor | Delete an item |
| `POST` | `/api/menu/images` | Vendor | Upload raw JPEG/PNG/WebP bytes to ImgBB |
| `GET` | `/api/menu/admin` | Admin | List/filter menu items by search, category, location, status, and sort |
| `GET` | `/api/menu/admin/pending` | Admin | List pending items |
| `PATCH` | `/api/menu/admin/:id/status` | Admin | Approve, reject, activate, or deactivate by status |
| `DELETE` | `/api/menu/admin/:id` | Admin | Delete an inappropriate item |
| `POST` | `/api/orders` | Customer | Create an order for an approved item |
| `GET` | `/api/orders/mine` | Customer or vendor | List own orders / orders for own items |
| `PATCH` | `/api/orders/:id/cancel` | Customer | Cancel own pending order |
| `PATCH` | `/api/orders/:id` | Owning vendor | Accept or reject a pending order |
| `POST` | `/api/subscriptions/checkout` | Vendor | Create a Premium Checkout session |
| `POST` | `/api/subscriptions/cancel` | Vendor | Cancel Premium at the current period end |
| `POST` | `/api/subscriptions/webhook` | Stripe signature | Verify Checkout and subscription events |
| `GET` | `/api/admin/dashboard` | Admin | Platform counts |
| `GET` | `/api/admin/users` | Admin | Search/filter customers and vendors |
| `PATCH` | `/api/admin/users/:id/block` | Admin | Block or unblock a customer/vendor |
| `GET` | `/api/admin/transactions` | Admin | Read-only transaction listing |
| `GET` | `/api/vendors/dashboard` | Vendor | Vendor menu/order/subscription counts |
| `GET` | `/api/vendors/profile` | Vendor | Read own restaurant profile |
| `PATCH` | `/api/vendors/profile` | Vendor | Update own name, business name, or image |
| `GET` | `/api/vendors/:id` | Public | Read public vendor profile |
| `GET` | `/api/customers/dashboard` | Customer | Customer order counts |

Protected API requests must include the JWT in the `Authorization` header. User and vendor ownership values are derived from the verified database user and stored menu item, not request payloads.

The earlier Pizza API remains available separately and uses the legacy `pizzas` collection:

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/pizzas` | Customer | Browse available legacy pizzas |
| `POST` | `/api/pizzas` | Vendor | Create a legacy pizza |
| `PUT` | `/api/pizzas/:id` | Owning vendor | Update a legacy pizza |
| `DELETE` | `/api/pizzas/:id` | Owning vendor | Delete a legacy pizza |

Assignment 9 menu and order flows use `menuItems`; the legacy pizza collection is not renamed, migrated, or used by the Orders API.

## Database collections

Better Auth manages its user, session, account, and key data. The application uses these business collections:

- `menuItems`: `vendorId`, `itemName`, `category`, `description`, `price`, `location`, `images`, `status`, `createdAt`.
- `orders`: `itemId`, `vendorId`, `customerId`, `deliveryDate`, `deliveryAddress`, `message`, `status`, `createdAt`.
- `transactions`: `vendorId`, `plan`, `amount`, `currency`, `stripeSessionId`, `stripeSubscriptionId`, `status`, `createdAt`. `amount` is stored in Stripe's smallest currency unit.

Menu status is one of `pending`, `approved`, `rejected`, or `inactive`. Only `approved` items are active and publicly visible. Vendors cannot set approval status; item edits and reactivation require admin approval.

## Security and verification notes

- Public registration accepts only customer or vendor roles. Admin role assignment must be performed through a trusted administrative process, not public signup.
- Stripe success redirects do not grant Premium. Only a verified webhook associated with a recorded Checkout session activates the subscription.
- A partial unique MongoDB index prevents concurrent pending/accepted orders for the same item and delivery date.
- Search terms are escaped before use in MongoDB regular expressions.
- API query flows for search, filters, and price sorting are implemented in the menu listing endpoint; protected API role checks run after JWT verification and database user lookup.

## Submission links

- Server repository: https://github.com/Sabbirromanbai/Assignment-9-server
- Client repository: not configured in this backend repository.
- Live site: not configured.
- Admin test credentials: provision securely for the deployed environment; do not store credentials in this repository.
