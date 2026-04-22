import { exec } from "child_process";
import express from "express";
import { findScenarioById } from "../lib/scenarioScanner.js";

function run(command, cwd) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

export function createTerminalRouter({ faultlabRoot }) {
  const router = express.Router();

  router.get("/scenarios/:id/containers", async (req, res) => {
    try {
      const scenario = await findScenarioById(faultlabRoot, req.params.id);
      if (!scenario) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }

      const prefix = scenario.id;
      const command = `docker ps --filter "name=${prefix}" --format "{{json .}}"`;
      const output = await run(command, scenario.scenarioDir);
      const rows = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .map((item) => item.Names)
        .filter(Boolean)
        .map((name) => ({
          name,
          role: name.startsWith(`${prefix}-`) ? name.slice(prefix.length + 1) : name
        }));

      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to list containers", detail: error.message });
    }
  });

  return router;
}

