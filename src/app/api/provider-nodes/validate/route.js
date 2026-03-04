import { NextResponse } from "next/server";

// Fetch with timeout wrapper
const fetchWithTimeout = (url, options, timeout = 10000) => {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Request timeout")), timeout)
    )
  ]);
};

// Validate URL format
const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Parse error details for user-friendly messages
const getErrorMessage = (error) => {
  if (error.cause?.code === "ECONNREFUSED") return "Connection refused - provider node offline or unreachable";
  if (error.cause?.code === "ENOTFOUND") return "DNS lookup failed - invalid domain or network issue";
  if (error.cause?.code === "ETIMEDOUT") return "Connection timeout - provider node too slow";
  if (error.message.includes("timeout")) return "Request timeout (>10s) - provider node not responding";
  if (error.cause?.code === "CERT_HAS_EXPIRED") return "SSL certificate expired";
  if (error.cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") return "SSL certificate verification failed";
  if (error.cause?.code) return `Network error: ${error.cause.code}`;
  return "Network connection failed - check URL and network connectivity";
};

// POST /api/provider-nodes/validate - Validate API key against base URL
export async function POST(request) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey, type } = body;

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: "Base URL and API key required" }, { status: 400 });
    }

    // Validate URL format
    if (!isValidUrl(baseUrl)) {
      return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
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

      return NextResponse.json({ valid: res.ok, error: res.ok ? null : "Invalid API key or unauthorized" });
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
    const errorMessage = getErrorMessage(error);
    console.error("Error validating provider node:", {
      message: error.message,
      cause: error.cause,
      code: error.cause?.code,
      userMessage: errorMessage
    });
    return NextResponse.json({ 
      valid: false,
      error: errorMessage 
    }, { status: 500 });
  }
}
