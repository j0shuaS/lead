import { createApp } from "../server/src/app";

module.exports = createApp();
// Vercel treats a default-exported Express app as a single Function and
// routes requests to it directly — no app.listen() needed or wanted here.
// vercel.json rewrites every /api/* request to this function; Express's
// own routing inside createApp() (mounted at /api) handles the rest.
export default createApp();