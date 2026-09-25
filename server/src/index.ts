import "dotenv/config";
import { createApp } from "./app";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

// A safety net: without this, an uncaught async error anywhere in the app
// can crash the whole Node process instead of just failing one request.
// (Only relevant to this always-on local/self-hosted entry point — the
// Vercel function in api/index.ts is a fresh invocation per request.)
process.on("unhandledRejection", (reason) => {
  console.error("[LEAD] Unhandled promise rejection:", reason);
});

const app = createApp();

app.listen(PORT, () => {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn(
      "\n[LEAD] Warning: GOOGLE_MAPS_API_KEY is not set. Searches will fail until you add it to server/.env.\n"
    );
  }
  console.log(`[LEAD] Server listening on http://localhost:${PORT}`);
});