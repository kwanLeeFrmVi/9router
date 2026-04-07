// Transform OpenAI SSE stream to Ollama JSON lines (ndjson) format.

interface PendingToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface ToolCallsByIndex {
  [index: number]: PendingToolCall;
}

export function transformToOllama(
  response: Response,
  model: string
): Response {
  let buffer = "";
  const pendingToolCalls: ToolCallsByIndex = {};

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: { enqueue: (chunk: Uint8Array) => void }): void {
      const text = new TextDecoder().decode(chunk);
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();

        if (data === "[DONE]") {
          const ollamaEnd = JSON.stringify({
            model,
            message: { role: "assistant", content: "" },
            done: true,
          }) + "\n";
          controller.enqueue(new TextEncoder().encode(ollamaEnd));
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta || {};
          const content = delta.content || "";
          const toolCalls = delta.tool_calls as Array<{
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;

          if (toolCalls) {
            for (const tc of toolCalls) {
              const idx = tc.index;
              if (!pendingToolCalls[idx]) {
                pendingToolCalls[idx] = { id: tc.id ?? "", function: { name: "", arguments: "" } };
              }
              if (tc.function?.name) pendingToolCalls[idx].function.name += tc.function.name;
              if (tc.function?.arguments) pendingToolCalls[idx].function.arguments += tc.function.arguments;
            }
          }

          if (content) {
            const ollama = JSON.stringify({ model, message: { role: "assistant", content }, done: false }) + "\n";
            controller.enqueue(new TextEncoder().encode(ollama));
          }

          const finishReason = parsed.choices?.[0]?.finish_reason;
          if (finishReason === "tool_calls") {
            const toolCallsArr = Object.values(pendingToolCalls);
            if (toolCallsArr.length > 0) {
              const formattedCalls = toolCallsArr.map((tc) => ({
                function: {
                  name: tc.function.name,
                  arguments: (() => {
                    try { return JSON.parse(tc.function.arguments || "{}"); }
                    catch { return {}; }
                  })(),
                },
              }));
              const ollama = JSON.stringify({
                model,
                message: { role: "assistant", content: "", tool_calls: formattedCalls },
                done: true,
              }) + "\n";
              controller.enqueue(new TextEncoder().encode(ollama));
              for (const key in pendingToolCalls) delete pendingToolCalls[parseInt(key)];
            }
          } else if (finishReason === "stop") {
            const ollamaEnd = JSON.stringify({
              model,
              message: { role: "assistant", content: "" },
              done: true,
            }) + "\n";
            controller.enqueue(new TextEncoder().encode(ollamaEnd));
          }
        } catch {
          // Silently ignore parse errors
        }
      }
    },
    flush(controller: { enqueue: (chunk: Uint8Array) => void }): void {
      const ollamaEnd = JSON.stringify({
        model,
        message: { role: "assistant", content: "" },
        done: true,
      }) + "\n";
      controller.enqueue(new TextEncoder().encode(ollamaEnd));
    },
  });

  if (!response.body) {
    return new Response("", {
      status: response.status,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  return new Response(response.body.pipeThrough(transform), {
    headers: { "Content-Type": "application/x-ndjson", "Access-Control-Allow-Origin": "*" },
  });
}