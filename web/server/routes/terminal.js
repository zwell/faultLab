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

function buildContainerPrefixes(scenario) {
  const base = String(scenario?.id || "").trim();
  const compact = base.replace(/[^a-zA-Z0-9]/g, "");
  const digitMatch = base.match(/(\d+)/g);
  const digits = digitMatch ? digitMatch.join("") : "";
  const tech = String(scenario?.tech || "").trim();
  const techCompact = (tech + digits).replace(/[^a-zA-Z0-9]/g, "");
  return Array.from(new Set([base, compact, techCompact].filter(Boolean)));
}

function parseDockerPsJsonLines(output, prefixes) {
  const rows = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let item;
    try {
      item = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const rawName = item.Names;
    const name = Array.isArray(rawName) ? rawName[0] : rawName;
    if (!name || typeof name !== "string") continue;
    const normalized = name.replace(/^\//, "");
    const matchedPrefix =
      prefixes.find((prefix) => normalized.startsWith(`${prefix}-`)) ||
      prefixes.find((prefix) => normalized.startsWith(prefix)) ||
      "";
    rows.push({
      name: normalized,
      role:
        matchedPrefix && normalized.startsWith(`${matchedPrefix}-`)
          ? normalized.slice(matchedPrefix.length + 1)
          : normalized
    });
  }
  return rows;
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

      const prefixes = buildContainerPrefixes(scenario);
      const psCommand = prefixes
        .map((prefix) => `docker ps --filter "name=${prefix}" --format "{{json .}}"`)
        .join(" ; ");

      try {
        const output = await run(psCommand, scenario.scenarioDir);
        const containers = parseDockerPsJsonLines(output, prefixes);
        res.json({
          containers,
          dockerOk: true,
          message: null
        });
      } catch (error) {
        const detail = error?.message || String(error);
        console.warn(`[containers] docker ps failed for ${scenario.id}:`, detail);
        res.json({
          containers: [],
          dockerOk: false,
          message:
            "无法连接 Docker 或未启动。请先在本机启动 Docker，再使用「启动环境」；此处仅用于列出运行中的容器快捷方式。"
        });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to list containers", detail: error.message });
    }
  });

  return router;
}

