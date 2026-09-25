import cors from "cors";
import express, { type Express } from "express";
import { qualityRouter } from "./routes/quality";
import { searchRouter } from "./routes/search";

// Builds the Express app without starting a server. server/src/index.ts
// calls this and .listen()s on it for local dev; api/index.ts (the Vercel
// serverless function) calls this and exports the app directly instead —
// Vercel hands it requests itself, no port needed.
export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, hasApiKey: Boolean(process.env.GOOGLE_MAPS_API_KEY) });
  });

  app.use("/api", searchRouter);
  app.use("/api", qualityRouter);

  return app;
}
