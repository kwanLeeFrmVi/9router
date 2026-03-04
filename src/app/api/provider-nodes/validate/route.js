import { NextResponse } from "next/server";

// POST /api/provider-nodes/validate - Validate API key against base URL
export async function POST(request) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey, type } = body;

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: "Base URL and API key required" }, { status: 400 });
    }

    // Anthropic Compatible Validation
    if (type === "anthropic-compatible") {
      // Robustly construct URL: remove trailing slash, and remove trailing /messages if user added it
      let normalizedBase = baseUrl.trim().replace(/\/$/, "");
      if (normalizedBase.endsWith("/messages")) {
        normalizedBase = normalizedBase.slice(0, -9); // remove /messages
      }

      // Use /models endpoint for validation as many compatible providers support it (like OpenAI)
      const modelsUrl = `${normalizedBase}/models`;

      const res = await fetch(modelsUrl, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Authorization": `Bearer ${apiKey}` // Add Bearer token for hybrid proxies
        }
      });

      return NextResponse.json({ valid: res.ok, error: res.ok ? null : "Invalid API key" });
    }

    // OpenAI Compatible Validation (Default)
    // Try /models first; fall back to chat/completions probe for providers
    // that don't expose a /models endpoint (e.g. Vertex AI).
    let normalizedBase = baseUrl.replace(/\/$/, "");
    // Strip endpoint paths so probes work even if user pasted the full URL
    if (normalizedBase.endsWith("/chat/completions")) {
      normalizedBase = normalizedBase.slice(0, -"/chat/completions".length);
    } else if (normalizedBase.endsWith("/completions")) {
      normalizedBase = normalizedBase.slice(0, -"/completions".length);
    } else if (normalizedBase.endsWith("/responses")) {
      normalizedBase = normalizedBase.slice(0, -"/responses".length);
    }
    const modelsRes = await fetch(`${normalizedBase}/models`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    if (modelsRes.ok) {
      return NextResponse.json({ valid: true, error: null });
    }

    const chatRes = await fetch(`${normalizedBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "ping",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }],
      }),
    });
    const isValid = chatRes.status !== 401 && chatRes.status !== 403;
    return NextResponse.json({ valid: isValid, error: isValid ? null : "Invalid API key" });
  } catch (error) {
    console.log("Error validating provider node:", error);
    return NextResponse.json({ error: "Validation failed" }, { status: 500 });
  }
}
