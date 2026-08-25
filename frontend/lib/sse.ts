/**
 * Minimal SSE frame parser over fetch + ReadableStream.
 *
 * The browser's native EventSource is GET-only and both of our streams need a
 * JSON request body, so we POST and parse `data:` frames by hand. The backend
 * emits one single-line JSON object per frame, which keeps this small enough
 * that a dependency would cost more than it saves.
 *
 * Extracted from streamChat when the workflow stream became the second caller.
 */
export async function consumeSSE<T>(
  response: Response,
  onEvent: (event: T) => void,
): Promise<void> {
  if (!response.ok) {
    throw new Error(`Harness returned ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("Harness returned no response body to stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line. The trailing element is kept as
      // the new buffer — it may be a partial frame split across chunks.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const line = frame
          .split("\n")
          .find((candidate) => candidate.startsWith("data:"));
        if (!line) continue; // `: comment` keep-alive frames

        try {
          onEvent(JSON.parse(line.slice(5).trim()) as T);
        } catch {
          console.warn("Skipping unparseable SSE frame:", frame);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
