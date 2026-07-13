import express from "express";
import { createServer } from "http";
import path from "path";
import { Server } from "socket.io";
import type {
  Ack,
  ClientToServerEvents,
  CreateRoomPayload,
  JoinRoomPayload,
  PlayMovePayload,
  RoomActionPayload,
  ServerToClientEvents,
  TributePickPayload,
  TributeReturnPayload
} from "../shared/types";
import { RoomManager } from "./roomManager";

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
const isProduction = process.env.NODE_ENV === "production" || process.env.npm_lifecycle_event === "start";
const port = Number(process.env.PORT ?? 3000);

const manager = new RoomManager((roomId) => {
  void broadcastRoom(roomId);
});

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.on("room:create", (payload, ack) => {
    handleSocketAction(socket, ack, () => {
      const room = manager.createRoom(payload.options, {
        id: payload.playerId,
        nickname: payload.nickname
      });
      room.join(payload.playerId, payload.nickname);
      manager.connect(room.state.roomId, payload.playerId);
      socket.data.roomId = room.state.roomId;
      socket.data.playerId = payload.playerId;
      void socket.join(room.state.roomId);
      void broadcastRoom(room.state.roomId);
      return { roomId: room.state.roomId };
    });
  });

  socket.on("room:join", (payload, ack) => {
    handleSocketAction(socket, ack, () => {
      const room = manager.getRoom(payload.roomId);
      room.join(payload.playerId, payload.nickname);
      manager.connect(room.state.roomId, payload.playerId);
      socket.data.roomId = room.state.roomId;
      socket.data.playerId = payload.playerId;
      void socket.join(room.state.roomId);
      void broadcastRoom(room.state.roomId);
      return { roomId: room.state.roomId };
    });
  });

  socket.on("game:start", (payload, ack) => {
    handleRoomAction(socket, payload, ack, (room) => {
      room.start(payload.playerId);
      void broadcastRoom(payload.roomId);
      return { started: true as const };
    });
  });

  socket.on("heart3:claimLead", (payload, ack) => {
    handleRoomAction(socket, payload, ack, (room) => {
      room.claimLead(payload.playerId);
      void broadcastRoom(payload.roomId);
      return { claimed: true as const };
    });
  });

  socket.on("red:reveal", (payload, ack) => {
    handleRoomAction(socket, payload, ack, (room) => {
      room.revealRed(payload.playerId);
      void broadcastRoom(payload.roomId);
      return { revealed: true as const };
    });
  });

  socket.on("move:play", (payload, ack) => {
    handleRoomAction(socket, payload, ack, (room) => {
      room.playCards(payload.playerId, payload.cardIds);
      void broadcastRoom(payload.roomId);
      return { accepted: true as const };
    });
  });

  socket.on("move:pass", (payload, ack) => {
    handleRoomAction(socket, payload, ack, (room) => {
      room.pass(payload.playerId);
      void broadcastRoom(payload.roomId);
      return { accepted: true as const };
    });
  });

  socket.on("tribute:pick", (payload, ack) => {
    handleRoomAction(socket, payload, ack, (room) => {
      room.pickTribute(payload.playerId, payload.cardId);
      void broadcastRoom(payload.roomId);
      return { accepted: true as const };
    });
  });

  socket.on("tribute:return", (payload, ack) => {
    handleRoomAction(socket, payload, ack, (room) => {
      room.returnTribute(payload.playerId, payload.cardIds);
      void broadcastRoom(payload.roomId);
      return { accepted: true as const };
    });
  });

  socket.on("disconnect", () => {
    if (socket.data.roomId && socket.data.playerId) {
      manager.disconnect(socket.data.roomId, socket.data.playerId);
      void broadcastRoom(socket.data.roomId);
    }
  });
});

void configureStaticServing().then(() => {
  httpServer.listen(port, () => {
    console.log(`Red Ten server listening on http://localhost:${port}`);
  });
});

async function configureStaticServing(): Promise<void> {
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      configFile: false,
      root: process.cwd(),
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
    return;
  }

  const clientPath = path.resolve(process.cwd(), "dist/client");
  app.use(express.static(clientPath));
  app.use((_request, response) => {
    response.sendFile(path.join(clientPath, "index.html"));
  });
}

async function broadcastRoom(roomId: string): Promise<void> {
  let room;
  try {
    room = manager.getRoom(roomId);
  } catch {
    return;
  }

  const sockets = await io.in(room.state.roomId).fetchSockets();
  for (const roomSocket of sockets) {
    const playerId = roomSocket.data.playerId;
    if (!playerId) continue;
    const state = room.getView(playerId);
    roomSocket.emit("room:state", state);
    if (state.phase === "finished") {
      roomSocket.emit("game:finished", state);
    }
  }
}

function handleSocketAction<T>(
  socket: Parameters<Parameters<typeof io.on>[1]>[0],
  ack: ((response: Ack<T>) => void) | undefined,
  action: () => T
): void {
  try {
    const data = action();
    ack?.({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    ack?.({ ok: false, error: message });
    socket.emit("game:error", { message });
  }
}

function handleRoomAction<T>(
  socket: Parameters<Parameters<typeof io.on>[1]>[0],
  payload:
    | RoomActionPayload
    | PlayMovePayload
    | TributePickPayload
    | TributeReturnPayload
    | CreateRoomPayload
    | JoinRoomPayload,
  ack: ((response: Ack<T>) => void) | undefined,
  action: (room: ReturnType<RoomManager["getRoom"]>) => T
): void {
  handleSocketAction(socket, ack, () => {
    if (!("roomId" in payload)) {
      throw new Error("Missing room id.");
    }
    const room = manager.getRoom(payload.roomId);
    return action(room);
  });
}
