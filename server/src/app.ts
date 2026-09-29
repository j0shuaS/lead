import type { Express } from "express";

const cors = require("cors");
const express = require("express");
const { searchRouter } = require("./routes/search");

function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req: any, res: any) => {
    res.json({ ok: true, hasApiKey: Boolean(process.env.GOOGLE_MAPS_API_KEY) });
  });

  app.use("/api", searchRouter);

  return app;
}

module.exports = { createApp };