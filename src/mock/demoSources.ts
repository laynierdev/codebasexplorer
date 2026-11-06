/**
 * Source files of the demo repository ("acme-shop-api"), embedded as strings.
 * Everything the prototype shows (tree, symbols, dependencies, graph, search)
 * is derived from these files, so navigation and citations stay consistent.
 * NOTE: contents must not contain backticks or dollar-brace sequences.
 */

export const DEMO_SOURCES: Record<string, string> = {
  "package.json": `{
  "name": "acme-shop-api",
  "version": "2.4.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest run"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "nodemailer": "^6.9.14",
    "pg": "^8.12.0",
    "stripe": "^16.2.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.16.5",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
`,

  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
`,

  ".env.example": `PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/shop
JWT_SECRET=change-me-change-me-change-me-change-me
STRIPE_SECRET_KEY=sk_test_replace_me
SMTP_URL=smtp://localhost:1025
`,

  "README.md": `# acme-shop-api

REST API for the Acme online shop: authentication, product catalog and orders.

## Getting started

1. Copy .env.example to .env and fill in the values.
2. Run the SQL in scripts/seed.sql against your PostgreSQL database.
3. npm install && npm run dev

## Layers

routes -> controllers -> services -> repositories -> PostgreSQL
`,

  "src/server.ts": `import { createApp } from './app';
import { env } from './config/env';
import { pool } from './db/client';

async function main() {
  await pool.query('SELECT 1');
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log('acme-shop-api listening on ' + env.PORT);
  });
}

main().catch((err) => {
  console.error('Failed to start', err);
  process.exit(1);
});
`,

  "src/app.ts": `import express from 'express';
import { registerRoutes } from './routes';
import { errorHandler } from './middleware/error.middleware';

export function createApp() {
  const app = express();
  app.use(express.json());
  registerRoutes(app);
  app.use(errorHandler);
  return app;
}
`,

  "src/config/env.ts": `import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  STRIPE_SECRET_KEY: z.string(),
  SMTP_URL: z.string(),
});

export const env = schema.parse(process.env);
`,

  "src/db/client.ts": `import { Pool } from 'pg';
import { env } from '../config/env';

export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}
`,

  "src/models/types.ts": `export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: 'customer' | 'admin';
  verified: boolean;
}

export interface Product {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
}

export interface OrderItem {
  productId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  totalCents: number;
  status: 'pending' | 'paid' | 'failed';
}
`,

  "src/middleware/auth.middleware.ts": `import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/auth.service';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.replace('Bearer ', '');
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  (req as Request & { user: typeof user }).user = user;
  next();
}
`,

  "src/middleware/error.middleware.ts": `import type { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err instanceof Error ? err.message : 'Internal error' });
}
`,

  "src/routes/index.ts": `import type { Express } from 'express';
import { authRouter } from './auth.routes';
import { productsRouter } from './products.routes';
import { ordersRouter } from './orders.routes';

export function registerRoutes(app: Express) {
  app.use('/api/auth', authRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/orders', ordersRouter);
}
`,

  "src/routes/auth.routes.ts": `import { Router } from 'express';
import { login, register } from '../controllers/auth.controller';

export const authRouter = Router();

authRouter.post('/register', register);
authRouter.post('/login', login);
`,

  "src/routes/products.routes.ts": `import { Router } from 'express';
import { listProducts, getProduct, createProduct } from '../controllers/products.controller';
import { requireAuth } from '../middleware/auth.middleware';

export const productsRouter = Router();

productsRouter.get('/', listProducts);
productsRouter.get('/:id', getProduct);
productsRouter.post('/', requireAuth, createProduct);
`,

  "src/routes/orders.routes.ts": `import { Router } from 'express';
import { createOrder, getOrder } from '../controllers/orders.controller';
import { requireAuth } from '../middleware/auth.middleware';

export const ordersRouter = Router();

ordersRouter.use(requireAuth);
ordersRouter.post('/', createOrder);
ordersRouter.get('/:id', getOrder);
`,

  "src/controllers/auth.controller.ts": `import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { loginUser, registerUser } from '../services/auth.service';

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const body = credentials.parse(req.body);
    const user = await registerUser(body.email, body.password);
    res.status(201).json({ id: user.id, email: user.email });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const body = credentials.parse(req.body);
    const token = await loginUser(body.email, body.password);
    res.json({ token });
  } catch (err) {
    next(err);
  }
}
`,

  "src/controllers/products.controller.ts": `import type { Request, Response, NextFunction } from 'express';
import { addProduct, findProduct, listCatalog } from '../services/product.service';

export async function listProducts(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listCatalog());
  } catch (err) {
    next(err);
  }
}

export async function getProduct(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await findProduct(req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function createProduct(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await addProduct(req.body));
  } catch (err) {
    next(err);
  }
}
`,

  "src/controllers/orders.controller.ts": `import type { Request, Response, NextFunction } from 'express';
import { getOrderForUser, placeOrder } from '../services/order.service';

export async function createOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as Request & { user: { id: string } }).user.id;
    const order = await placeOrder(userId, req.body.items);
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
}

export async function getOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as Request & { user: { id: string } }).user.id;
    res.json(await getOrderForUser(userId, req.params.id));
  } catch (err) {
    next(err);
  }
}
`,

  "src/services/auth.service.ts": `import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { HttpError } from '../middleware/error.middleware';
import { createUser, findUserByEmail } from '../repositories/user.repository';
import { sendVerificationEmail } from './email.service';
import type { User } from '../models/types';

export async function registerUser(email: string, password: string): Promise<User> {
  const existing = await findUserByEmail(email);
  if (existing) throw new HttpError(409, 'Email already registered');
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUser(email, passwordHash);
  await sendVerificationEmail(user);
  return user;
}

export async function loginUser(email: string, password: string): Promise<string> {
  const user = await findUserByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'Invalid credentials');
  }
  return signToken(user);
}

export function signToken(user: User): string {
  return jwt.sign({ id: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: '1h' });
}

export function verifyToken(token: string): { id: string; role: string } | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as { id: string; role: string };
  } catch {
    return null;
  }
}
`,

  "src/services/email.service.ts": `import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { signToken } from './auth.service';
import type { User } from '../models/types';

const transport = nodemailer.createTransport(env.SMTP_URL);

export async function sendVerificationEmail(user: User) {
  const token = signToken(user);
  await transport.sendMail({
    to: user.email,
    subject: 'Verify your account',
    text: 'Your verification token: ' + token,
  });
}

export async function sendOrderReceipt(user: User, totalCents: number) {
  await transport.sendMail({
    to: user.email,
    subject: 'Your Acme receipt',
    text: 'Total charged: ' + (totalCents / 100).toFixed(2),
  });
}
`,

  "src/services/product.service.ts": `import { HttpError } from '../middleware/error.middleware';
import { getAllProducts, getProductById, insertProduct } from '../repositories/product.repository';
import type { Product } from '../models/types';

export async function listCatalog(): Promise<Product[]> {
  return getAllProducts();
}

export async function findProduct(id: string): Promise<Product> {
  const product = await getProductById(id);
  if (!product) throw new HttpError(404, 'Product not found');
  return product;
}

export async function addProduct(input: Omit<Product, 'id'>): Promise<Product> {
  if (input.priceCents <= 0) throw new HttpError(400, 'Invalid price');
  return insertProduct(input);
}
`,

  "src/services/order.service.ts": `import { HttpError } from '../middleware/error.middleware';
import { findOrder, saveOrder } from '../repositories/order.repository';
import { decrementStock, getProductById } from '../repositories/product.repository';
import { findUserById } from '../repositories/user.repository';
import { chargeCustomer } from './payment.service';
import { sendOrderReceipt } from './email.service';
import type { Order, OrderItem } from '../models/types';

export async function placeOrder(
  userId: string,
  items: { productId: string; quantity: number }[],
): Promise<Order> {
  const priced: OrderItem[] = [];
  for (const item of items) {
    const product = await getProductById(item.productId);
    if (!product || product.stock < item.quantity) {
      throw new HttpError(409, 'Insufficient stock for ' + item.productId);
    }
    priced.push({ productId: product.id, quantity: item.quantity, unitPriceCents: product.priceCents });
  }
  const totalCents = priced.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
  const order = await saveOrder({ userId, items: priced, totalCents, status: 'pending' });
  const paid = await chargeCustomer(order);
  for (const item of priced) {
    await decrementStock(item.productId, item.quantity);
  }
  const user = await findUserById(userId);
  if (user) await sendOrderReceipt(user, totalCents);
  return paid;
}

export async function getOrderForUser(userId: string, orderId: string): Promise<Order> {
  const order = await findOrder(orderId);
  if (!order || order.userId !== userId) throw new HttpError(404, 'Order not found');
  return order;
}
`,

  "src/services/payment.service.ts": `import Stripe from 'stripe';
import { env } from '../config/env';
import { HttpError } from '../middleware/error.middleware';
import { saveOrder } from '../repositories/order.repository';
import type { Order } from '../models/types';

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export async function chargeCustomer(order: Order): Promise<Order> {
  try {
    await stripe.paymentIntents.create({
      amount: order.totalCents,
      currency: 'usd',
      metadata: { orderId: order.id },
    });
    return saveOrder({ ...order, status: 'paid' });
  } catch {
    await saveOrder({ ...order, status: 'failed' });
    throw new HttpError(402, 'Payment failed');
  }
}
`,

  "src/repositories/user.repository.ts": `import { query } from '../db/client';
import type { User } from '../models/types';

export async function findUserByEmail(email: string): Promise<User | null> {
  const rows = await query<User>('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const rows = await query<User>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function createUser(email: string, passwordHash: string): Promise<User> {
  const rows = await query<User>(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *',
    [email, passwordHash],
  );
  return rows[0]!;
}
`,

  "src/repositories/product.repository.ts": `import { query } from '../db/client';
import type { Product } from '../models/types';

export async function getAllProducts(): Promise<Product[]> {
  return query<Product>('SELECT * FROM products ORDER BY name');
}

export async function getProductById(id: string): Promise<Product | null> {
  const rows = await query<Product>('SELECT * FROM products WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function insertProduct(input: Omit<Product, 'id'>): Promise<Product> {
  const rows = await query<Product>(
    'INSERT INTO products (name, price_cents, stock) VALUES ($1, $2, $3) RETURNING *',
    [input.name, input.priceCents, input.stock],
  );
  return rows[0]!;
}

export async function decrementStock(id: string, quantity: number): Promise<void> {
  await query('UPDATE products SET stock = stock - $2 WHERE id = $1', [id, quantity]);
}
`,

  "src/repositories/order.repository.ts": `import { query } from '../db/client';
import type { Order } from '../models/types';

export async function saveOrder(order: Omit<Order, 'id'> & { id?: string }): Promise<Order> {
  const rows = await query<Order>(
    'INSERT INTO orders (id, user_id, items, total_cents, status) VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status RETURNING *',
    [order.id ?? null, order.userId, JSON.stringify(order.items), order.totalCents, order.status],
  );
  return rows[0]!;
}

export async function findOrder(id: string): Promise<Order | null> {
  const rows = await query<Order>('SELECT * FROM orders WHERE id = $1', [id]);
  return rows[0] ?? null;
}
`,

  "tests/auth.service.test.ts": `import { describe, expect, it, vi } from 'vitest';
import { loginUser } from '../src/services/auth.service';

vi.mock('../src/repositories/user.repository');

describe('loginUser', () => {
  it('rejects unknown users', async () => {
    await expect(loginUser('nobody@example.com', 'secret123')).rejects.toThrow('Invalid credentials');
  });
});
`,

  "tests/order.service.test.ts": `import { describe, expect, it, vi } from 'vitest';
import { placeOrder } from '../src/services/order.service';

vi.mock('../src/services/payment.service');

describe('placeOrder', () => {
  it('fails when stock is insufficient', async () => {
    await expect(placeOrder('user-1', [{ productId: 'p1', quantity: 999 }])).rejects.toThrow();
  });
});
`,

  "scripts/seed.sql": `CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  verified BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  items JSONB NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);
`,

  "scripts/sales_report.py": `import csv
import sys

# Nightly sales report. Reads an orders CSV export and prints revenue per day.
def main(path):
    totals = {}
    with open(path) as handle:
        for row in csv.DictReader(handle):
            day = row["created_at"][:10]
            totals[day] = totals.get(day, 0) + int(row["total_cents"])
    for day, cents in sorted(totals.items()):
        print(day, cents / 100)

if __name__ == "__main__":
    main(sys.argv[1])
`,
};

/** Files and folders the scanner would skip in a real ZIP of this project. */
export const DEMO_SKIPPED = [
  { path: "node_modules/", reason: "ignored-directory", detail: "Third-party dependencies (default ignore list)", fileCount: 41812 },
  { path: ".git/", reason: "ignored-directory", detail: "Version-control metadata (default ignore list)", fileCount: 2390 },
  { path: "dist/", reason: "ignored-directory", detail: "Build output (default ignore list)", fileCount: 64 },
  { path: "coverage/", reason: "ignored-directory", detail: "Test coverage output (default ignore list)", fileCount: 118 },
  { path: "package-lock.json", reason: "ignored-pattern", detail: "Lock file (generated, 612 KB)" },
  { path: "assets/logo.png", reason: "binary", detail: "Binary image, not analyzable (18 KB)" },
  { path: "assets/catalog-seed.xlsx", reason: "binary", detail: "Binary spreadsheet, not analyzable (240 KB)" },
  { path: "docs/architecture-export.json", reason: "too-large", detail: "2.8 MB exceeds the 1 MB per-file limit" },
] as const;

/** Short purpose for each file (mock: hand-written; Stage 3 generates these). */
export const DEMO_PURPOSES: Record<string, string> = {
  "package.json": "Package manifest: dependencies and npm scripts.",
  "tsconfig.json": "TypeScript compiler configuration.",
  ".env.example": "Documents the environment variables the API expects.",
  "README.md": "Project readme with setup steps.",
  "src/server.ts": "Process entry point: checks the database, builds the app and starts listening.",
  "src/app.ts": "Builds the Express application and wires middleware and routes.",
  "src/config/env.ts": "Validates environment variables with Zod at startup.",
  "src/db/client.ts": "PostgreSQL connection pool and a typed query helper.",
  "src/models/types.ts": "Shared domain types: User, Product, Order, OrderItem.",
  "src/middleware/auth.middleware.ts": "Express middleware that requires a valid JWT bearer token.",
  "src/middleware/error.middleware.ts": "HttpError class and the central Express error handler.",
  "src/routes/index.ts": "Mounts the feature routers under /api.",
  "src/routes/auth.routes.ts": "Registration and login routes.",
  "src/routes/products.routes.ts": "Product catalog routes (write access requires auth).",
  "src/routes/orders.routes.ts": "Order routes, all behind authentication.",
  "src/controllers/auth.controller.ts": "HTTP handlers for register/login with request validation.",
  "src/controllers/products.controller.ts": "HTTP handlers for listing, reading and creating products.",
  "src/controllers/orders.controller.ts": "HTTP handlers for placing and reading orders.",
  "src/services/auth.service.ts": "Registration, login and JWT signing/verification.",
  "src/services/email.service.ts": "Sends verification and receipt emails via SMTP.",
  "src/services/product.service.ts": "Catalog business rules on top of the product repository.",
  "src/services/order.service.ts": "Order placement: stock check, pricing, payment, stock update, receipt.",
  "src/services/payment.service.ts": "Charges customers through Stripe and records the payment status.",
  "src/repositories/user.repository.ts": "SQL access for the users table.",
  "src/repositories/product.repository.ts": "SQL access for the products table.",
  "src/repositories/order.repository.ts": "SQL access for the orders table.",
  "tests/auth.service.test.ts": "Unit test for login behavior.",
  "tests/order.service.test.ts": "Unit test for order placement.",
  "scripts/seed.sql": "Creates the PostgreSQL schema (text-only, not parsed).",
  "scripts/sales_report.py": "Nightly revenue report script (Python, indexed as text only).",
};
