import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";

async function walk(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return walk(fullPath);
      }
      return fullPath;
    })
  );

  return files.flat();
}

function toSlashPath(value) {
  return value.replaceAll("\\", "/");
}

function normalizeDifficulty(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 99;
}

export async function scanScenarios(faultlabRoot) {
  const root = path.resolve(faultlabRoot);
  const scenariosDir = path.resolve(root, "scenarios");
  const allFiles = await walk(scenariosDir);
  const metaFiles = allFiles.filter((filePath) => filePath.endsWith("meta.yaml"));
  const scenarios = await Promise.all(
    metaFiles.map(async (metaPath) => {
      const raw = await fs.readFile(metaPath, "utf-8");
      const data = yaml.load(raw) || {};
      const scenarioDir = path.dirname(metaPath);
      const relativeDir = toSlashPath(path.relative(root, scenarioDir));

      return {
        ...data,
        id: data.id || path.basename(scenarioDir),
        tech: data.tech || path.basename(path.dirname(scenarioDir)),
        difficulty: normalizeDifficulty(data.difficulty),
        scenarioDir,
        relativeDir
      };
    })
  );

  return scenarios.sort((a, b) => {
    if (a.tech !== b.tech) {
      return String(a.tech).localeCompare(String(b.tech));
    }
    return a.difficulty - b.difficulty;
  });
}

export async function findScenarioById(faultlabRoot, scenarioId) {
  const scenarios = await scanScenarios(faultlabRoot);
  return scenarios.find((item) => item.id === scenarioId) || null;
}

