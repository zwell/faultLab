import { exec } from "child_process";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { findScenarioById } from "./lib/scenarioScanner.js";
import { getOrCreatePty, registerOutputListener, resizePty } from "./lib/ptyManager.js";
import { createScenarioRouter } from "./routes/scenarios.js";
import { createTerminalRouter } from "./routes/terminal.js";
import { createActionsRouter } from "./routes/actions.js";
import { createVerifyRouter } from "./routes/verify.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..");
const faultlabRoot = path.resolve(process.env.FAULTLAB_ROOT || path.resolve(webRoot, ".."));
const port = Number(process.env.PORT || 3001);

function checkDocker() {
  exec("docker info", (error) => {
    if (error) {
      console.warn("[warn] Docker unavailable. Start Docker Desktop before running scenarios.");
    }
  });
}

const app = express();
app.use(express.json());
app.use("/api", createScenarioRouter({ faultlabRoot }));
app.use("/api", createTerminalRouter({ faultlabRoot }));
app.use("/api", createActionsRouter({ faultlabRoot }));
app.use("/api", createVerifyRouter({ faultlabRoot }));

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (request, socket, head) => {
  try {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/ws\/terminal\/([^/]+)$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const scenarioId = decodeURIComponent(match[1]);
    const scenario = await findScenarioById(faultlabRoot, scenarioId);
    if (!scenario) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.scenarioId = scenarioId;
      ws.scenarioDir = scenario.scenarioDir;
      wss.emit("connection", ws);
    });
  } catch (_error) {
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  const ptySession = getOrCreatePty(ws.scenarioId, ws.scenarioDir);
  const unsubscribe = registerOutputListener(ws.scenarioId, (chunk) => {
    if (ws.readyState === 1) {
      ws.send(chunk);
    }
  });

  ws.on("message", (raw) => {
    let payload = null;
    try {
      payload = JSON.parse(raw.toString());
    } catch (_error) {
      payload = { type: "input", data: raw.toString() };
    }

    if (payload?.type === "resize") {
      resizePty(ws.scenarioId, payload.cols, payload.rows);
      return;
    }

    if (payload?.type === "input" && typeof payload.data === "string") {
      ptySession.write(payload.data);
    }
  });

  ws.on("close", () => {
    unsubscribe();
  });
});

server.listen(port, () => {
  checkDocker();
  console.log(`FaultLab server listening on http://localhost:${port}`);
  console.log(`FAULTLAB_ROOT resolved to: ${faultlabRoot}`);
});

