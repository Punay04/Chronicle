const baseUrl = (process.env.CHRONICLE_API_URL || "http://127.0.0.1:3030").replace(
  /\/$/,
  ""
);
const marker = `chronicleeval${Date.now()}`;

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

const now = Date.now();
const oldTime = new Date(now - 60_000).toISOString();
const newTime = new Date(now).toISOString();

await request("/memory/sessions", {
  sessionId: `__chronicle_eval__${marker}-old`,
  startedAt: oldTime,
  turns: [
    {
      role: "user",
      content: `My ${marker} city is Austin.`,
      timestamp: oldTime,
    },
  ],
});

await request("/memory/sessions", {
  sessionId: `__chronicle_eval__${marker}-new`,
  startedAt: newTime,
  turns: [
    {
      role: "user",
      content: `My ${marker} city is Seattle.`,
      timestamp: newTime,
    },
  ],
});

const temporal = await request("/memory/retrieve", {
  query: marker,
});
const absent = await request("/memory/retrieve", {
  query: `missingbooking${Date.now()}`,
});

const checks = {
  current_fact: temporal.snippets.some(
    (snippet) => snippet.startsWith("[current") && snippet.includes("Seattle")
  ),
  superseded_fact: temporal.snippets.some(
    (snippet) => snippet.startsWith("[superseded") && snippet.includes("Austin")
  ),
  abstention: absent.snippets.some((snippet) => snippet.startsWith("[abstain]")),
};

const passed = Object.values(checks).filter(Boolean).length;
console.log(
  JSON.stringify(
    {
      benchmark: "Chronicle temporal-memory smoke evaluation",
      score: `${passed}/${Object.keys(checks).length}`,
      checks,
      query_snippets: temporal.snippets,
      abstention_snippets: absent.snippets,
    },
    null,
    2
  )
);

if (passed !== Object.keys(checks).length) process.exitCode = 1;
