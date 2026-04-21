import { exec } from "child_process";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createScenarioRouter } from "./routes/scenarios.js";

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

app.listen(port, () => {
  checkDocker();
  console.log(`FaultLab server listening on http://localhost:${port}`);
  console.log(`FAULTLAB_ROOT resolved to: ${faultlabRoot}`);
});

