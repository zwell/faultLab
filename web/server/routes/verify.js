import express from "express";
import fs from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { findScenarioById } from "../lib/scenarioScanner.js";

function loadEnv(faultlabRoot) {
  dotenv.config({ path: path.join(faultlabRoot, ".env") });
}

function getVerifyBackend() {
  if (process.env.ANTHROPIC_API_KEY) {
    return { type: "anthropic", provider: "anthropic" };
  }
  const provider = (process.env.VERIFY_PROVIDER || "qwen").trim().toLowerCase();
  if (provider === "openai") {
    const key = process.env.VERIFY_API_KEY || process.env.OPENAI_API_KEY;
    if (key) return { type: "openai-compatible", provider: "openai" };
  }
  const key = process.env.VERIFY_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (key) return { type: "openai-compatible", provider: "qwen" };
  return { type: "none", provider: null };
}

function resolveProviderConfig(selectedProvider) {
  const provider = (selectedProvider || process.env.VERIFY_PROVIDER || "qwen").trim().toLowerCase();
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    return {
      provider,
      type: apiKey ? "anthropic" : "none",
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620",
      error: apiKey ? null : "未配置 ANTHROPIC_API_KEY"
    };
  }

  if (provider === "openai") {
    const apiKey = process.env.VERIFY_API_KEY || process.env.OPENAI_API_KEY;
    return {
      provider,
      type: apiKey ? "openai-compatible" : "none",
      apiUrl: process.env.VERIFY_API_URL || "https://api.openai.com/v1/chat/completions",
      apiKey,
      model: process.env.VERIFY_MODEL || "gpt-4o-mini",
      error: apiKey ? null : "未配置 OPENAI_API_KEY / VERIFY_API_KEY"
    };
  }

  const qwenKey = process.env.VERIFY_API_KEY || process.env.DASHSCOPE_API_KEY;
  return {
    provider: "qwen",
    type: qwenKey ? "openai-compatible" : "none",
    apiUrl: process.env.VERIFY_API_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    apiKey: qwenKey,
    model: process.env.VERIFY_MODEL || "qwen-plus",
    error: qwenKey ? null : "未配置 DASHSCOPE_API_KEY / VERIFY_API_KEY"
  };
}

function buildSystemPrompt(solutionText) {
  return `你是一个故障排查教练。学习者正在练习排查以下场景的故障。

## 场景标准答案
${solutionText}

## 你的任务
- 根据「评分要点（Scoring Rubric）」判断学习者的描述达到哪个级别
- 指出学习者描述中正确的部分，给予肯定
- 指出缺失或错误的关键点，给出提示但不直接给出答案
- 如果学习者已达到 full_credit，给出鼓励并推荐延伸思考方向
- 语气友好，像一个有经验的同事在做 code review
- 回复使用中文`;
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function openAiMessages(systemPrompt, history, message) {
  const out = [{ role: "system", content: systemPrompt }];
  for (const item of history || []) {
    if (item.role === "user" || item.role === "assistant") {
      out.push({ role: item.role, content: item.content });
    }
  }
  out.push({ role: "user", content: message });
  return out;
}

function anthropicMessages(history, message) {
  const out = [];
  for (const item of history || []) {
    if (item.role === "user") out.push({ role: "user", content: item.content });
    else if (item.role === "assistant") out.push({ role: "assistant", content: item.content });
  }
  out.push({ role: "user", content: message });
  return out;
}

async function streamOpenAICompatible(res, apiUrl, apiKey, model, messages) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true
    })
  });

  if (!response.ok) {
    const text = await response.text();
    sseWrite(res, { t: "error", m: `模型请求失败：${text.slice(0, 500)}` });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";

    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) sseWrite(res, { t: "chunk", c: piece });
      } catch (_err) {
        // ignore parse errors for keep-alive lines
      }
    }
  }
}

async function streamAnthropic(res, systemPrompt, history, message) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620";
  const messages = anthropicMessages(history, message);

  let stream;
  try {
    stream = await client.messages.stream({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages
    });
  } catch (err) {
    sseWrite(res, { t: "error", m: err.message || "Anthropic 请求失败" });
    return;
  }

  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
        sseWrite(res, { t: "chunk", c: event.delta.text });
      }
    }
  } catch (err) {
    sseWrite(res, { t: "error", m: err.message || "流式输出中断" });
  }
}

export function createVerifyRouter({ faultlabRoot }) {
  const router = express.Router();

  router.get("/scenarios/:id/verify-status", async (req, res) => {
    loadEnv(faultlabRoot);
    const scenario = await findScenarioById(faultlabRoot, req.params.id);
    if (!scenario) {
      res.status(404).json({ configured: false, message: "场景不存在" });
      return;
    }

    const backend = getVerifyBackend();
    if (backend.type === "none") {
      res.json({
        configured: false,
        defaultProvider: (process.env.VERIFY_PROVIDER || "qwen").trim().toLowerCase(),
        providers: ["qwen", "openai", "anthropic"],
        message:
          "未检测到可用的 LLM 配置。请在仓库根目录 .env 中配置其一：ANTHROPIC_API_KEY（推荐，与阶段四计划一致），或沿用 CLI 的 VERIFY_PROVIDER + DASHSCOPE_API_KEY / OPENAI_API_KEY。"
      });
      return;
    }

    res.json({
      configured: true,
      provider: backend.provider,
      defaultProvider: (process.env.VERIFY_PROVIDER || backend.provider || "qwen").trim().toLowerCase(),
      providers: ["qwen", "openai", "anthropic"]
    });
  });

  router.post("/scenarios/:id/verify", async (req, res) => {
    loadEnv(faultlabRoot);
    const scenario = await findScenarioById(faultlabRoot, req.params.id);
    if (!scenario) {
      res.status(404).json({ error: "Scenario not found" });
      return;
    }

    const { message, history, provider: selectedProvider, model: selectedModel } = req.body || {};
    const resolved = resolveProviderConfig(selectedProvider);
    const backend = { type: resolved.type, provider: resolved.provider };
    if (backend.type === "none") {
      res.status(503).json({
        error: resolved.error || "未配置 API Key，请检查 .env"
      });
      return;
    }

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const solutionPath = path.join(scenario.scenarioDir, "SOLUTION.md");
    let solutionText = "";
    try {
      solutionText = await fs.readFile(solutionPath, "utf-8");
    } catch (_err) {
      res.status(500).json({ error: "SOLUTION.md not found for this scenario" });
      return;
    }

    const systemPrompt = buildSystemPrompt(solutionText);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    try {
      if (backend.type === "anthropic") {
        if (selectedModel && typeof selectedModel === "string") {
          process.env.ANTHROPIC_MODEL = selectedModel.trim();
        }
        await streamAnthropic(res, systemPrompt, history, message);
      } else {
        const apiUrl = resolved.apiUrl;
        const apiKey = resolved.apiKey;
        const model = (selectedModel && selectedModel.trim()) || resolved.model;

        if (!apiKey || !apiUrl) {
          sseWrite(res, { t: "error", m: "API Key 未配置" });
        } else {
          const msgs = openAiMessages(systemPrompt, history, message);
          await streamOpenAICompatible(res, apiUrl, apiKey, model, msgs);
        }
      }
      sseWrite(res, { t: "done" });
    } catch (err) {
      sseWrite(res, { t: "error", m: err.message || "verify failed" });
      sseWrite(res, { t: "done" });
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  return router;
}
