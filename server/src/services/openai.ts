const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// gpt-4o-mini is cheaper per request than gpt-3.5-turbo and writes
// noticeably better copy, so it's the default here. Override with the
// OPENAI_MODEL env var if you want a different model.
const DEFAULT_MODEL = "gpt-4o-mini";

class OpenAIError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "OpenAIError";
    this.status = status;
  }
}

const SYSTEM_PROMPT =
  "You help a small outreach agency evaluate local business websites for AI chatbot potential. " +
  'Given the visible text of a business\'s website, respond with STRICT JSON only, no markdown ' +
  'fences: {"summary": string, "pitch": string}. ' +
  '"summary" is 2-3 plain-language sentences describing what the business actually does. ' +
  '"pitch" is 3-5 sentences written to the business owner, explaining specifically how an AI ' +
  "chatbot on their site could help THEM — tie it to things you actually saw on their site " +
  "(their services, hours, booking process, FAQs, product list, etc.) rather than generic " +
  "claims. Keep the tone helpful and concrete, not salesy or hypey.";

// Sends the extracted site text to OpenAI and returns a structured
// { summary, pitch } pair. Throws OpenAIError with a .status on any
// failure, so the route can report a sensible HTTP status back to the UI.
async function generateChatbotPitch(
  siteText: string,
  url: string
): Promise<{ summary: string; pitch: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OpenAIError(
      "The server has no OpenAI API key configured. Add OPENAI_API_KEY to server/.env and restart the server.",
      500
    );
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const userPrompt = `Website URL: ${url}\n\nExtracted page text:\n${siteText}`;

  let response: Response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
      }),
    });
  } catch (networkError) {
    throw new OpenAIError("Could not reach OpenAI. Check your internet connection and try again.", 502);
  }

  if (!response.ok) {
    let message = `OpenAI API request failed (HTTP ${response.status}).`;
    try {
      const body = (await response.json()) as any;
      if (body?.error?.message) {
        message = body.error.message;
      }
    } catch {
      // Response body wasn't JSON; fall back to the generic message above.
    }

    console.error(`[LEAD] OpenAI API error: HTTP ${response.status} — ${message}`);

    if (response.status === 401) {
      message += " Check that OPENAI_API_KEY is correct.";
    }
    if (response.status === 429) {
      message += " OpenAI rate limit or quota reached — check your OpenAI account's billing/usage.";
    }

    const statusToReport = response.status === 401 || response.status === 429 ? response.status : 502;
    throw new OpenAIError(message, statusToReport);
  }

  const data = (await response.json()) as any;
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) {
    throw new OpenAIError("OpenAI returned an empty response.", 502);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OpenAIError("OpenAI returned a response LEAD couldn't parse.", 502);
  }

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    pitch: typeof parsed.pitch === "string" ? parsed.pitch : "",
  };
}

module.exports = { OpenAIError, generateChatbotPitch };
