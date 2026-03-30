import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

const defaultFirebaseConfig = {
  VITE_FIREBASE_API_KEY: "AIzaSyDFkNHHxpcRNB_2n_JaDJxD0sCI_cY2skA",
  VITE_FIREBASE_AUTH_DOMAIN: "my-cash-flow-bcb24.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "my-cash-flow-bcb24",
  VITE_FIREBASE_STORAGE_BUCKET: "my-cash-flow-bcb24.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "660839296094",
  VITE_FIREBASE_APP_ID: "1:660839296094:f0e9e5bd5a9518cf",
};

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "25mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.get("/app-config.js", (_req, res) => {
  const firebaseConfig = {
    VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY || defaultFirebaseConfig.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN:
      process.env.VITE_FIREBASE_AUTH_DOMAIN || defaultFirebaseConfig.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID:
      process.env.VITE_FIREBASE_PROJECT_ID || defaultFirebaseConfig.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET:
      process.env.VITE_FIREBASE_STORAGE_BUCKET || defaultFirebaseConfig.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID:
      process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || defaultFirebaseConfig.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID || defaultFirebaseConfig.VITE_FIREBASE_APP_ID,
  };

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(
    `window.__APP_CONFIG__ = ${JSON.stringify(firebaseConfig).replace(/</g, "\\u003c")};`,
  );
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
