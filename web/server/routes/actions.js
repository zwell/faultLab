import express from "express";
import fs from "fs";
import { findScenarioById } from "../lib/scenarioScanner.js";
import { getOrCreatePty, getPtyShellKind, registerOutputListener } from "../lib/ptyManager.js";
import { toPosixPath } from "../lib/shellRunner.js";

const SUMMARY_START = "=== FaultLab Inject Summary ===";
const SUMMARY_END = "================================";
const GIT_BASH = "C:/Program Files/Git/bin/bash.exe";

const START_OK = "Environment ready";
const START_UNHEALTHY = "Environment started but not fully healthy";

const injectLocks = new Map();
const startLocks = new Map();

function faultlabCommandLine(faultlabRoot, scenarioRelativeDir, action, shellKind) {
  const root = toPosixPath(faultlabRoot);
  const rel = scenarioRelativeDir.replace(/\\/g, "/");
  const inner = `cd "${root}" && export FAULTLAB_SCENARIO="${rel}" && ./cli/faultlab.sh ${action}`;

  if (shellKind === "git-bash" || shellKind === "bash" || shellKind === "zsh" || shellKind === "sh") {
    return `${inner}\n`;
  }

  if (shellKind === "powershell" && process.platform === "win32" && fs.existsSync(GIT_BASH)) {
    const escaped = inner.replace(/\\/g, "/").replace(/"/g, '\\"');
    return `& "${GIT_BASH.replace(/\\/g, "/")}" -lc "${escaped}"\n`;
  }

  return `${inner}\n`;
}

function tryParseInjectSummary(buffer) {
  const start = buffer.indexOf(SUMMARY_START);
  if (start === -1) return null;
  const end = buffer.indexOf(SUMMARY_END, start + SUMMARY_START.length);
  if (end === -1) return null;

  const block = buffer.slice(start + SUMMARY_START.length, end);
  const summary = {};
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (key) summary[key] = value;
  }
  return summary;
}

function waitForStartResult(scenarioId, timeoutMs) {
  return new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    const deadline = Date.now() + timeoutMs;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = registerOutputListener(scenarioId, (chunk) => {
      buffer += chunk;
      if (buffer.includes(START_OK)) {
        finish({ ok: true });
        return;
      }
      if (buffer.includes(START_UNHEALTHY)) {
        finish({
          ok: false,
          detail: "环境未在超时内变为健康，请先查看终端输出并修复后再注入。"
        });
        return;
      }
      if (/^\s*ERROR:/m.test(buffer)) {
        finish({ ok: false, detail: "启动失败（见终端输出）。" });
      }
    });

    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        finish({ ok: false, detail: "等待启动完成超时，请查看终端输出。" });
      }
    }, 400);
  });
}

function waitForInjectSummary(scenarioId, timeoutMs) {
  return new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    const deadline = Date.now() + timeoutMs;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = registerOutputListener(scenarioId, (chunk) => {
      buffer += chunk;
      const summary = tryParseInjectSummary(buffer);
      if (summary) {
        finish({ ok: true, summary });
        return;
      }
      if (!buffer.includes(SUMMARY_START) && /^\s*ERROR:/m.test(buffer)) {
        finish({ ok: false, detail: "Inject failed (see terminal output)." });
      }
    });

    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        finish({ ok: false, detail: "Timed out waiting for inject summary." });
      }
    }, 400);
  });
}

export function createActionsRouter({ faultlabRoot }) {
  const router = express.Router();

  router.post("/scenarios/:id/start", async (req, res) => {
    const scenarioId = req.params.id;
    if (startLocks.get(scenarioId)) {
      res.status(409).json({ ok: false, error: "该场景正在启动中，请稍候。" });
      return;
    }

    startLocks.set(scenarioId, true);
    try {
      const scenario = await findScenarioById(faultlabRoot, scenarioId);
      if (!scenario) {
        res.status(404).json({ ok: false, error: "Scenario not found" });
        return;
      }

      const ptyProcess = getOrCreatePty(scenario.id, scenario.scenarioDir);
      const shellKind = getPtyShellKind(scenario.id);
      const resultPromise = waitForStartResult(scenario.id, 360000);
      ptyProcess.write(faultlabCommandLine(faultlabRoot, scenario.relativeDir, "start", shellKind));
      const result = await resultPromise;

      if (!result.ok) {
        res.status(500).json({ ok: false, error: result.detail || "start failed" });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || "start failed" });
    } finally {
      startLocks.delete(scenarioId);
    }
  });

  router.post("/scenarios/:id/clean", async (req, res) => {
    try {
      const scenario = await findScenarioById(faultlabRoot, req.params.id);
      if (!scenario) {
        res.status(404).json({ ok: false, error: "Scenario not found" });
        return;
      }

      const ptyProcess = getOrCreatePty(scenario.id, scenario.scenarioDir);
      const shellKind = getPtyShellKind(scenario.id);
      ptyProcess.write(faultlabCommandLine(faultlabRoot, scenario.relativeDir, "clean", shellKind));
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || "clean failed" });
    }
  });

  router.post("/scenarios/:id/inject", async (req, res) => {
    const scenarioId = req.params.id;
    if (injectLocks.get(scenarioId)) {
      res.status(409).json({ ok: false, error: "Inject already running for this scenario." });
      return;
    }

    injectLocks.set(scenarioId, true);
    try {
      const scenario = await findScenarioById(faultlabRoot, scenarioId);
      if (!scenario) {
        res.status(404).json({ ok: false, error: "Scenario not found" });
        return;
      }

      const ptyProcess = getOrCreatePty(scenario.id, scenario.scenarioDir);
      const shellKind = getPtyShellKind(scenario.id);
      const resultPromise = waitForInjectSummary(scenario.id, 240000);
      ptyProcess.write(faultlabCommandLine(faultlabRoot, scenario.relativeDir, "inject", shellKind));
      const result = await resultPromise;

      if (!result.ok) {
        res.status(500).json({ ok: false, error: result.detail || "inject failed" });
        return;
      }

      res.json({ ok: true, summary: result.summary });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || "inject failed" });
    } finally {
      injectLocks.delete(scenarioId);
    }
  });

  return router;
}
