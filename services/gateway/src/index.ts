import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";

import {
  startHermesRun,
  waitForHermes,
  steerHermes,
  stopHermes,
} from "./hermes.js";

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ],
});

app.get("/health", async () => {
  return {
    status: "ok",
    service: "lumi-gateway",
  };
});

app.post<{
  Body: {
    input: string;
    sessionId: string;
  };
}>("/api/hermes", async (request) => {
  const { input, sessionId } = request.body;

  const run = await startHermesRun(
    input,
    sessionId,
  );

  const output = await waitForHermes(run.run_id);

  return {
    runId: run.run_id,
    output,
  };
});

app.post<{
  Params: {
    runId: string;
  };
  Body: {
    input: string;
  };
}>("/api/hermes/:runId/steer", async (request) => {
  await steerHermes(
    request.params.runId,
    request.body.input,
  );

  return {
    ok: true,
  };
});

app.post<{
  Params: {
    runId: string;
  };
}>("/api/hermes/:runId/stop", async (request) => {
  await stopHermes(request.params.runId);

  return {
    ok: true,
  };
});

const port = Number(process.env.PORT ?? 8787);

app.post<{
    Body: {
      sdp: string;
    };
  }>("/api/live/session", async (request, reply) => {
    const response = await fetch(
      "https://api.openai.com/v1/live/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: {
            model: "gpt-live-1",
  
            delegation: {
              type: "client",
            },
  
            instructions: `
  You are Lumi's real-time conversational interface.
  
  You are not the primary reasoning agent.
  
  For substantive requests, questions, plans, decisions,
  memory retrieval, or actions, delegate to the client.
  
  The client delegation is Hermes, which is Lumi's authoritative
  reasoning and action engine.
  
  You handle:
  - listening
  - natural turn-taking
  - interruptions
  - conversational acknowledgements
  - rendering Hermes results naturally in speech
  
  Never invent a substantive answer when Hermes should answer.
  Keep spoken responses concise and conversational.
            `.trim(),
  
            audio: {
              output: {
                voice: "vesper"
              }
            }
          },
  
          transport: {
            type: "webrtc",
            sdp: request.body.sdp,
          },
        }),
      },
    );
  
    if (!response.ok) {
      return reply
        .status(response.status)
        .send(await response.text());
    }
  
    return response.json();
  });

  await app.listen({
    host: "0.0.0.0",
    port,
  });