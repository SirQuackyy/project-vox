const HERMES_URL =
  process.env.HERMES_URL ?? "http://127.0.0.1:8642";

const HERMES_API_KEY = process.env.HERMES_API_KEY!;

export type HermesRun = {
  run_id: string;
  status: string;
  output?: string;
};

function headers(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${HERMES_API_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function startHermesRun(
  input: string,
  sessionId: string,
) {
  const response = await fetch(`${HERMES_URL}/v1/runs`, {
    method: "POST",
    headers: headers({
      "Idempotency-Key": crypto.randomUUID(),
      "X-Hermes-Session-Key": `lumi:${sessionId}`,
    }),
    body: JSON.stringify({
      input,
      session_id: sessionId,
      instructions: `
You are Lumi's reasoning and action engine.

The user is speaking to you through a low-latency voice interface.

Answer naturally and concisely unless more detail is requested.

You are authoritative for reasoning, memory, and external actions.
The voice frontend must not independently reason in your place.
      `.trim(),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Hermes start failed: ${response.status} ${await response.text()}`,
    );
  }

  return (await response.json()) as HermesRun;
}

export async function getHermesRun(runId: string) {
  const response = await fetch(`${HERMES_URL}/v1/runs/${runId}`, {
    headers: headers(),
  });

  if (!response.ok) {
    throw new Error(
      `Hermes status failed: ${response.status} ${await response.text()}`,
    );
  }

  return (await response.json()) as HermesRun;
}

export async function waitForHermes(
  runId: string,
  timeoutMs = 120_000,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const run = await getHermesRun(runId);

    if (run.status === "completed") {
      return run.output ?? "";
    }

    if (
      run.status === "failed" ||
      run.status === "cancelled"
    ) {
      throw new Error(`Hermes run ${run.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Hermes run timed out");
}

export async function steerHermes(
  runId: string,
  input: string,
) {
  const response = await fetch(
    `${HERMES_URL}/v1/runs/${runId}/steer`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        input,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function stopHermes(runId: string) {
  const response = await fetch(
    `${HERMES_URL}/v1/runs/${runId}/stop`,
    {
      method: "POST",
      headers: headers(),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }
}
