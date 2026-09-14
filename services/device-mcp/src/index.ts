import {
    McpServer,
  } from "@modelcontextprotocol/server";
  
  import {
    StdioServerTransport,
  } from "@modelcontextprotocol/server/stdio";
  
  import * as z
    from "zod/v4";
  
  
  const gateway =
    process.env.VOX_GATEWAY_URL ??
    "http://127.0.0.1:8787";
  
  
  async function gatewayCall(
    deviceId: string,
    body: Record<
      string,
      unknown
    >,
  ) {
    const response =
      await fetch(
        `${gateway}/internal/devices/${deviceId}/command`,
        {
          method: "POST",
  
          headers: {
            "Content-Type":
              "application/json",
          },
  
          body:
            JSON.stringify(body),
        },
      );
  
  
    if (!response.ok) {
      throw new Error(
        await response.text(),
      );
    }
  
  
    return (
      await response.json()
    ) as any;
  }
  
  
  const server =
    new McpServer({
      name:
        "lumi-device-control",
  
      version:
        "0.1.0",
    });
  
  
  server.registerTool(
    "list_devices",
  
    {
      description:
        "List the user's computers and other Lumi devices currently online.",
  
      inputSchema:
        z.object({}),
  
      annotations: {
        readOnlyHint: true,
      },
    },
  
    async () => {
      const response =
        await fetch(
          `${gateway}/internal/devices`,
        );
  
      const value =
        await response.text();
  
      return {
        content: [
          {
            type: "text",
            text: value,
          },
        ],
      };
    },
  );
  
  
  server.registerTool(
    "cua_describe",
  
    {
      description:
        "Get the exact current Cua Driver JSON schema for a computer-control tool on a Lumi device. Use this if unsure what arguments a Cua tool accepts.",
  
      inputSchema:
        z.object({
          device_id:
            z.string(),
  
          tool:
            z.string(),
        }),
  
      annotations: {
        readOnlyHint: true,
      },
    },
  
    async ({
      device_id,
      tool,
    }) => {
      const value =
        await gatewayCall(
          device_id,
          {
            command:
              "cua.describe",
  
            tool,
          },
        );
  
      return {
        content: [
          {
            type: "text",
            text:
              JSON.stringify(
                value.result,
              ),
          },
        ],
      };
    },
  );
  
  
  server.registerTool(
    "computer",
  
    {
      description: `
  Operate one of the user's Lumi-connected computers using Cua Driver.
  
  Typical workflow:
  
  1. list_apps or list_windows
  2. get_window_state for the selected window
  3. inspect returned accessibility element indexes and screenshot
  4. click/type/scroll
  5. get_window_state again to verify
  
  Prefer accessibility element actions over raw pixel coordinates.
  
  Use cua_describe first when you do not know a tool's exact argument schema.
      `.trim(),
  
      inputSchema:
        z.object({
          device_id:
            z.string(),
  
          tool:
            z.enum([
              "list_apps",
              "list_windows",
              "get_accessibility_tree",
              "get_window_state",
              "get_desktop_state",
              "get_screen_size",
  
              "click",
              "type_text",
              "press_key",
              "hotkey",
              "scroll",
              "drag",
  
              "launch_app",
  
              "verify_state",
              "wait",
            ]),
  
          /*
           * Keeping args as JSON text means
           * Cua's rapidly changing schema
           * does not require rebuilding Lumi.
           */
          args_json:
            z.string()
              .default("{}"),
        }),
    },
  
    async ({
      device_id,
      tool,
      args_json,
    }) => {
      let args:
        Record<
          string,
          unknown
        >;
  
  
      try {
        args =
          JSON.parse(
            args_json,
          );
      } catch {
        throw new Error(
          "args_json must contain valid JSON",
        );
      }
  
  
      const value =
        await gatewayCall(
          device_id,
          {
            command:
              "cua.call",
  
            tool,
  
            args,
          },
        );
  
  
      const content:
        any[] = [];
  
  
      if (
        value.result
      ) {
        content.push({
          type: "text",
  
          text:
            typeof value
              .result ===
              "string"
              ? value.result
              : JSON.stringify(
                  value.result,
                ),
        });
      }
  
  
      /*
       * Critical:
       *
       * send screenshots to Hermes/model
       * as actual MCP image content,
       * not a giant text base64 string.
       */
      if (
        value.image?.data
      ) {
        content.push({
          type: "image",
  
          data:
            value.image.data,
  
          mimeType:
            value.image.mimeType,
        });
      }
  
  
      return {
        content,
      };
    },
  );
  
  
  const transport =
    new StdioServerTransport();
  
  
  await server.connect(
    transport,
  );