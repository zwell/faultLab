import express from "express";
import fs from "fs/promises";
import path from "path";
import { scanScenarios } from "../lib/scenarioScanner.js";

function createFilters(query) {
  return {
    tech: query.tech,
    difficulty: query.difficulty ? Number(query.difficulty) : undefined,
    resourceLevel: query.resource_level
  };
}

export function createScenarioRouter({ faultlabRoot }) {
  const router = express.Router();

  router.get("/scenarios", async (req, res) => {
    try {
      const filters = createFilters(req.query);
      const scenarios = await scanScenarios(faultlabRoot);
      const filtered = scenarios.filter((scenario) => {
        if (filters.tech && scenario.tech !== filters.tech) return false;
        if (filters.resourceLevel && scenario.resource_level !== filters.resourceLevel) return false;
        if (filters.difficulty !== undefined && scenario.difficulty !== filters.difficulty) return false;
        return true;
      });

      res.json(
        filtered.map(({ scenarioDir, ...rest }) => ({
          ...rest
        }))
      );
    } catch (error) {
      res.status(500).json({ error: "Failed to load scenarios", detail: error.message });
    }
  });

  router.get("/scenarios/:id/readme", async (req, res) => {
    try {
      const scenarios = await scanScenarios(faultlabRoot);
      const scenario = scenarios.find((item) => item.id === req.params.id);
      if (!scenario) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }

      const readmePath = path.resolve(scenario.scenarioDir, "README.md");
      const readme = await fs.readFile(readmePath, "utf-8");
      res.type("text/plain").send(readme);
    } catch (error) {
      res.status(500).json({ error: "Failed to load scenario README", detail: error.message });
    }
  });

  return router;
}

