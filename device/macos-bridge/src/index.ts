import "dotenv/config";

import WebSocket from "ws";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const GATEWAY =
  process.env.VOX_GATEWAY_WS!;

const DEVICE_ID =
  process.env.VOX_DEVICE_ID!;

const DEVICE_NAME =
  process.env.VOX_DEVICE_NAME ?? DEVICE_ID;

const DEVICE_TOKEN =
  process.env.VOX_DEVICE_TOKEN!;


/*
 * Do NOT initially expose every Cua capability remotely.
 *
 * Add things deliberately.
 */
const ALLOWED_CUA_TOOLS = new Set([
  // inspection
  "list_apps",
  "list_windows",
  "get_accessibility_tree",
  "get_window_state",
  "get_desktop_state",
  "get_screen_size",

  // normal GUI control
  "click",
  "type_text",
  "press_key",
  "hotkey",
  "scroll",
  "drag",

  // app lifecycle
  "launch_app",

  // verification
  "verify_state",
  "wait",
]);


type GatewayMessage =
  | {
      type: "device.command";
      id: string;

      command:
        | "ping"
        | "cua.list_tools"
        | "cua.describe"
        | "cua.call";

      tool?: string;
      args?: Record<string, unknown>;
    };


type ResultMessage = {
  type: "device.result";

  id: string;

  ok: boolean;

  result?: unknown;

  image?: {
    mimeType: "image/png";
    data: string;
  };

  error?: string;
};


async function run(
  command: string,
  args: string[],
) {
  const {
    stdout,
    stderr,
  } = await execFileAsync(
    command,
    args,
    {
      maxBuffer:
        50 * 1024 * 1024,
    },
  );

  return {
    stdout,
    stderr,
  };
}


async function cuaListTools() {
  const result =
    await run("cua-driver", [
      "list-tools",
    ]);

  return result.stdout;
}


async function cuaDescribe(
  tool: string,
) {
  if (!ALLOWED_CUA_TOOLS.has(tool)) {
    throw new Error(
      `Cua tool not allowed: ${tool}`,
    );
  }

  const result =
    await run("cua-driver", [
      "describe",
      tool,
    ]);

  return result.stdout;
}


async function cuaCall(
  tool: string,
  args: Record<string, unknown>,
) {
  if (!ALLOWED_CUA_TOOLS.has(tool)) {
    throw new Error(
      `Cua tool not allowed: ${tool}`,
    );
  }

  /*
   * Screenshots are special because we want
   * to return the PNG separately instead of
   * shoving base64 into ordinary text.
   */

  const producesImage =
    tool === "get_desktop_state" ||
    tool === "get_window_state";

  let screenshotPath:
    | string
    | undefined;

  const actualArgs = {
    ...args,
  };

  if (producesImage) {
    screenshotPath = path.join(
      os.tmpdir(),
      `lumi-${crypto.randomUUID()}.png`,
    );

    actualArgs.screenshot_out_file =
      screenshotPath;
  }

  try {
    const result =
      await run("cua-driver", [
        "call",
        tool,
        JSON.stringify(actualArgs),
      ]);

    let image:
      | {
          mimeType: "image/png";
          data: string;
        }
      | undefined;

    if (screenshotPath) {
      try {
        const bytes =
          await fs.readFile(
            screenshotPath,
          );

        image = {
          mimeType: "image/png",
          data:
            bytes.toString("base64"),
        };
      } catch {
        // Screenshot may legitimately
        // not have been produced.
      }
    }

    return {
      text: result.stdout,
      stderr: result.stderr,
      image,
    };
  } finally {
    if (screenshotPath) {
      await fs.rm(
        screenshotPath,
        {
          force: true,
        },
      );
    }
  }
}


async function handle(
  message: GatewayMessage,
): Promise<ResultMessage> {
  try {
    switch (message.command) {
      case "ping":
        return {
          type: "device.result",
          id: message.id,
          ok: true,
          result: {
            deviceId: DEVICE_ID,
            deviceName: DEVICE_NAME,
            hostname:
              os.hostname(),
            platform:
              os.platform(),
          },
        };


      case "cua.list_tools":
        return {
          type: "device.result",
          id: message.id,
          ok: true,
          result:
            await cuaListTools(),
        };


      case "cua.describe":
        if (!message.tool) {
          throw new Error(
            "tool required",
          );
        }

        return {
          type: "device.result",
          id: message.id,
          ok: true,
          result:
            await cuaDescribe(
              message.tool,
            ),
        };


      case "cua.call":
        if (!message.tool) {
          throw new Error(
            "tool required",
          );
        }

        const result =
          await cuaCall(
            message.tool,
            message.args ?? {},
          );

        return {
          type: "device.result",
          id: message.id,
          ok: true,
          result: {
            text: result.text,
            stderr:
              result.stderr,
          },
          image:
            result.image,
        };


      default:
        throw new Error(
          "Unknown command",
        );
    }
  } catch (error) {
    return {
      type: "device.result",
      id: message.id,
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}


function connect() {
  console.log(
    `Connecting ${DEVICE_ID} to Lumi...`,
  );

  const ws =
    new WebSocket(GATEWAY, {
      headers: {
        Authorization:
          `Bearer ${DEVICE_TOKEN}`,

        "X-Lumi-Device-Id":
          DEVICE_ID,

        "X-Lumi-Device-Name":
          DEVICE_NAME,
      },
    });


  ws.on("open", () => {
    console.log(
      "Connected to Lumi Gateway.",
    );
  });


  ws.on(
    "message",
    async (raw) => {
      try {
        const message =
          JSON.parse(
            raw.toString(),
          ) as GatewayMessage;

        if (
          message.type !==
          "device.command"
        ) {
          return;
        }

        const response =
          await handle(message);

        ws.send(
          JSON.stringify(response),
        );
      } catch (error) {
        console.error(error);
      }
    },
  );


  ws.on("close", () => {
    console.log(
      "Disconnected. Reconnecting...",
    );

    setTimeout(
      connect,
      2000,
    );
  });


  ws.on("error", (error) => {
    console.error(
      "WebSocket error:",
      error,
    );
  });
}


connect();