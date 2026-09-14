import type WebSocket from "ws";

type DeviceResult = {
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


type Pending = {
  resolve:
    (value: DeviceResult) => void;

  reject:
    (error: Error) => void;

  timeout:
    NodeJS.Timeout;
};


type DeviceConnection = {
  socket: WebSocket;
  name: string;
};


const devices =
  new Map<
    string,
    DeviceConnection
  >();


const pending =
  new Map<
    string,
    Pending
  >();


export function registerDevice(
  deviceId: string,
  name: string,
  socket: WebSocket,
) {
  const old =
    devices.get(deviceId);

  if (old) {
    try {
      old.socket.close();
    } catch {}
  }

  devices.set(
    deviceId,
    {
      socket,
      name,
    },
  );

  console.log(
    `Device connected: ${deviceId}`,
  );


  socket.on("message", (raw) => {
    let msg: DeviceResult;

    try {
      msg =
        JSON.parse(
          raw.toString(),
        );
    } catch {
      return;
    }

    if (
      msg.type !==
      "device.result"
    ) {
      return;
    }

    const request =
      pending.get(msg.id);

    if (!request) {
      return;
    }

    clearTimeout(
      request.timeout,
    );

    pending.delete(msg.id);

    request.resolve(msg);
  });


  socket.on("close", () => {
    const current =
      devices.get(deviceId);

    if (
      current?.socket === socket
    ) {
      devices.delete(deviceId);

      console.log(
        `Device disconnected: ${deviceId}`,
      );
    }
  });
}


export function listDevices() {
  return [
    ...devices.entries(),
  ].map(
    ([id, value]) => ({
      id,
      name: value.name,
      online: true,
    }),
  );
}


export async function sendDeviceCommand(
  deviceId: string,

  payload: {
    command: string;
    tool?: string;
    args?: Record<
      string,
      unknown
    >;
  },

  timeoutMs = 30_000,
): Promise<DeviceResult> {
  const device =
    devices.get(deviceId);

  if (!device) {
    throw new Error(
      `Device offline: ${deviceId}`,
    );
  }


  const id =
    crypto.randomUUID();


  return new Promise(
    (resolve, reject) => {
      const timeout =
        setTimeout(() => {
          pending.delete(id);

          reject(
            new Error(
              `Device command timed out: ${deviceId}`,
            ),
          );
        }, timeoutMs);


      pending.set(id, {
        resolve,
        reject,
        timeout,
      });


      device.socket.send(
        JSON.stringify({
          type:
            "device.command",

          id,

          ...payload,
        }),
      );
    },
  );
}