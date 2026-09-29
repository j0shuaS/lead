const cors = require("cors");
const express = require("express");
const { searchRouter } = require("./routes/search");

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, hasApiKey: Boolean(process.env.GOOGLE_MAPS_API_KEY) });
  });

  app.use("/api", searchRouter);

  return app;
}

module.exports = { createApp };