import { next } from "@vercel/edge";

// Runs on every request before anything else — static files, the API,
// all of it — so there's no path that skips the login prompt.
export const config = {
  matcher: "/(.*)",
};

const USERNAME = "admin";

function isAuthorized(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Basic ")) return false;

  let decoded: string;
  try {
    decoded = atob(authHeader.slice("Basic ".length));
  } catch {
    return false;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return false;

  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  const expectedPassword = process.env.BASIC_AUTH_PASSWORD;
  if (!expectedPassword) {
    // Fail closed: if the password isn't configured, nobody gets in
    // rather than everybody getting in.
    return false;
  }

  return user === USERNAME && password === expectedPassword;
}

export default function middleware(request: Request) {
  if (isAuthorized(request)) {
    return next();
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="LEAD", charset="UTF-8"' },
  });
}
