const { Router } = require("express");
const { fetchSiteText } = require("../services/siteText");
const { generateChatbotPitch } = require("../services/openai");

const pitchRouter = Router();

pitchRouter.post("/pitch", async (req: any, res: any) => {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";

  if (!url) {
    return res.status(400).json({ error: "A website URL is required." });
  }

  try {
    const siteText = await fetchSiteText(url);
    const result = await generateChatbotPitch(siteText, url);
    return res.json({ url, ...result });
  } catch (err) {
    const status = err && typeof err === "object" && typeof (err as any).status === "number"
      ? (err as any).status
      : 502;
    console.error("[LEAD] Pitch generation failed:", err);
    return res.status(status).json({
      error: err instanceof Error ? err.message : "Something went wrong generating the pitch.",
    });
  }
});

module.exports = { pitchRouter };
