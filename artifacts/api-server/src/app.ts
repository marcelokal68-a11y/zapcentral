import express, { type Express } from "express";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// ---------------------------------------------------------------------------
// CORS — only allow explicitly listed trusted origins.
// In production set ALLOWED_ORIGINS as a comma-separated list of the exact
// origins that serve the frontend (e.g. https://zapcentral.example.com).
// In development the Replit dev domain is auto-added so the Vite app works.
// ---------------------------------------------------------------------------
const trustedOrigins = new Set<string>();

(process.env["ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean)
  .forEach((o) => trustedOrigins.add(o));

// Replit dev domain — safe to add only in development
if (
  process.env["NODE_ENV"] !== "production" &&
  process.env["REPLIT_DEV_DOMAIN"]
) {
  trustedOrigins.add(`https://${process.env["REPLIT_DEV_DOMAIN"]}`);
}

const corsOptions: CorsOptions = {
  credentials: true,
  origin(origin, callback) {
    // Requests with no Origin header (server-to-server, curl) are always allowed
    if (!origin) {
      callback(null, true);
      return;
    }
    if (trustedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    // In development also allow localhost on any port
    if (
      process.env["NODE_ENV"] !== "production" &&
      /^https?:\/\/localhost(:\d+)?$/.test(origin)
    ) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
};

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// Clerk proxy must come before body parsers (streams raw bytes)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Resolve publishable key from request host (supports multiple custom domains)
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env["CLERK_PUBLISHABLE_KEY"],
    ),
  })),
);

app.use("/api", router);

export default app;
