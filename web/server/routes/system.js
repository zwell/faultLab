import { exec } from "child_process";
import express from "express";
import fs from "fs";
import path from "path";

function checkDocker() {
  return new Promise((resolve) => {
    exec("docker info --format '{{.ServerVersion}}'", { timeout: 4000 }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || error.message || "").trim();
        resolve({
          key: "docker",
          label: "Docker",
          ok: false,
          detail: detail || "无法连接 Docker daemon",
          hint: "请先启动 Docker Desktop（或等价 Docker daemon）"
        });
        return;
      }

      const version = (stdout || "").trim();
      resolve({
        key: "docker",
        label: "Docker",
        ok: true,
        detail: version ? `已连接（Server ${version}）` : "已连接",
        hint: null
      });
    });
  });
}

function checkEnvFile(faultlabRoot) {
  const envPath = path.resolve(faultlabRoot, ".env");
  const ok = fs.existsSync(envPath);
  return {
    key: "env",
    label: ".env",
    ok,
    detail: ok ? "已检测到 .env" : "未检测到 .env",
    hint: ok ? null : "在仓库根目录执行：cp .env.example .env"
  };
}

async function runSystemChecks(faultlabRoot) {
  const checks = [await checkDocker(), checkEnvFile(faultlabRoot)];
  const ok = checks.every((item) => item.ok);
  return { ok, checks, checkedAt: new Date().toISOString() };
}

export function createSystemStateStore({ faultlabRoot }) {
  let latest = null;

  return {
    getLatest() {
      return latest;
    },
    async refresh() {
      latest = await runSystemChecks(faultlabRoot);
      return latest;
    }
  };
}

export function createSystemRouter({ faultlabRoot, systemStateStore }) {
  const router = express.Router();

  router.get("/system/checks", async (_req, res) => {
    if (systemStateStore?.getLatest()) {
      res.json(systemStateStore.getLatest());
      return;
    }

    const latest = systemStateStore ? await systemStateStore.refresh() : await runSystemChecks(faultlabRoot);
    res.json(latest);
  });

  return router;
}

