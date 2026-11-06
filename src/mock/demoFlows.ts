import type { ExecutionFlow } from "@/domain/types";

/**
 * Detected execution flows for the demo repository (mock data).
 * Steps reference symbols by name; line ranges are resolved against the real
 * parsed symbols at render time, so a reference can never point at nothing.
 */
export const DEMO_FLOWS: ExecutionFlow[] = [
  {
    id: "place-order",
    title: "Place an order",
    trigger: "POST /api/orders",
    summary: "An authenticated customer submits cart items; stock is checked, the order is saved, payment is charged, stock is decremented and a receipt is emailed.",
    steps: [
      { title: "App is built", description: "createApp installs the JSON body parser, registers routes and the error handler.", file: "src/app.ts", symbol: "createApp", evidence: "verified" },
      { title: "Orders router mounted", description: "registerRoutes mounts ordersRouter under /api/orders.", file: "src/routes/index.ts", symbol: "registerRoutes", evidence: "verified" },
      { title: "Authentication required", description: "ordersRouter.use(requireAuth) runs before every order route.", file: "src/middleware/auth.middleware.ts", symbol: "requireAuth", evidence: "verified" },
      { title: "Controller handles request", description: "createOrder reads the user id from the request and delegates to placeOrder.", file: "src/controllers/orders.controller.ts", symbol: "createOrder", evidence: "verified" },
      { title: "Stock check and pricing", description: "placeOrder loads every product and rejects with 409 if stock is insufficient.", file: "src/services/order.service.ts", symbol: "placeOrder", evidence: "verified" },
      { title: "Order persisted as pending", description: "saveOrder writes the order row (upsert on id).", file: "src/repositories/order.repository.ts", symbol: "saveOrder", evidence: "verified" },
      { title: "Payment charged", description: "chargeCustomer creates a Stripe payment intent and stores the paid/failed status.", file: "src/services/payment.service.ts", symbol: "chargeCustomer", evidence: "verified" },
      { title: "Stock decremented", description: "decrementStock runs once per item after payment.", file: "src/repositories/product.repository.ts", symbol: "decrementStock", evidence: "verified" },
      { title: "Receipt emailed", description: "sendOrderReceipt sends an SMTP email to the customer.", file: "src/services/email.service.ts", symbol: "sendOrderReceipt", evidence: "verified" },
      { title: "No transactional boundary", description: "No database transaction wraps save, charge and stock update, so a failure in the middle can leave inconsistent state. This is a reading of the code, not an observed failure.", file: "src/services/order.service.ts", symbol: "placeOrder", evidence: "inferred" },
    ],
  },
  {
    id: "login",
    title: "User login",
    trigger: "POST /api/auth/login",
    summary: "Credentials are validated, the user is looked up by email, the password hash is compared and a one-hour JWT is returned.",
    steps: [
      { title: "Route", description: "authRouter maps POST /login to the login controller.", file: "src/routes/auth.routes.ts", symbol: "authRouter", evidence: "verified" },
      { title: "Input validation", description: "login parses the body with the credentials Zod schema.", file: "src/controllers/auth.controller.ts", symbol: "login", evidence: "verified" },
      { title: "Credential check", description: "loginUser loads the user and compares the bcrypt hash.", file: "src/services/auth.service.ts", symbol: "loginUser", evidence: "verified" },
      { title: "User lookup", description: "findUserByEmail runs a parameterized SQL query.", file: "src/repositories/user.repository.ts", symbol: "findUserByEmail", evidence: "verified" },
      { title: "Token issued", description: "signToken signs { id, role } with JWT_SECRET, expiring in one hour.", file: "src/services/auth.service.ts", symbol: "signToken", evidence: "verified" },
    ],
  },
  {
    id: "register",
    title: "Registration with verification email",
    trigger: "POST /api/auth/register",
    summary: "A new user is created and a verification email containing a signed token is sent.",
    steps: [
      { title: "Controller", description: "register validates input and calls registerUser.", file: "src/controllers/auth.controller.ts", symbol: "register", evidence: "verified" },
      { title: "Duplicate check and hashing", description: "registerUser rejects existing emails with 409 and hashes the password (cost 12).", file: "src/services/auth.service.ts", symbol: "registerUser", evidence: "verified" },
      { title: "User row created", description: "createUser inserts into the users table.", file: "src/repositories/user.repository.ts", symbol: "createUser", evidence: "verified" },
      { title: "Verification email", description: "sendVerificationEmail signs a token via signToken and sends it by SMTP.", file: "src/services/email.service.ts", symbol: "sendVerificationEmail", evidence: "verified" },
      { title: "Circular dependency", description: "email.service imports signToken from auth.service while auth.service imports sendVerificationEmail from email.service. It works today because both are used inside functions, but it is fragile.", file: "src/services/email.service.ts", symbol: "sendVerificationEmail", evidence: "inferred" },
    ],
  },
  {
    id: "protected-request",
    title: "Protected request authentication",
    trigger: "Any route behind requireAuth",
    summary: "The bearer token is extracted and verified; invalid tokens get a 401, valid ones attach the user to the request.",
    steps: [
      { title: "Middleware", description: "requireAuth reads the Authorization header and strips the Bearer prefix.", file: "src/middleware/auth.middleware.ts", symbol: "requireAuth", evidence: "verified" },
      { title: "Token verification", description: "verifyToken checks the signature with JWT_SECRET and returns the payload or null.", file: "src/services/auth.service.ts", symbol: "verifyToken", evidence: "verified" },
      { title: "Errors", description: "Failures flow to errorHandler, which maps HttpError status codes to JSON responses.", file: "src/middleware/error.middleware.ts", symbol: "errorHandler", evidence: "verified" },
    ],
  },
];
