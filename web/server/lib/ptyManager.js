import fs from "fs";
import path from "path";
import pty from "node-pty";

const sessions = new Map();
const listeners = new Map();
const shellKinds = new Map();

function getShell() {
  if (process.platform === "win32") {
    const gitBash = "C:/Program Files/Git/bin/bash.exe";
    if (fs.existsSync(gitBash)) {
      return { command: gitBash, args: ["--login", "-i"], kind: "git-bash" };
    }

    console.warn("[warn] Git Bash not found. Falling back to PowerShell.");
    return {
      command: "powershell.exe",
      args: ["-NoLogo"],
      kind: "powershell"
    };
  }

  if (fs.existsSync("/bin/bash")) {
    return { command: "/bin/bash", args: ["-l"], kind: "bash" };
  }

  if (fs.existsSync("/bin/zsh")) {
    return { command: "/bin/zsh", args: ["-l"], kind: "zsh" };
  }

  return { command: "sh", args: ["-l"], kind: "sh" };
}

function emitOutput(scenarioId, chunk) {
  const scenarioListeners = listeners.get(scenarioId);
  if (!scenarioListeners) return;
  scenarioListeners.forEach((handler) => handler(chunk));
}

export function getOrCreatePty(scenarioId, cwd) {
  if (sessions.has(scenarioId)) {
    return sessions.get(scenarioId);
  }

  const shell = getShell();
  const ptyProcess = pty.spawn(shell.command, shell.args, {
    cwd: path.resolve(cwd),
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    env: {
      ...process.env,
      MSYS_NO_PATHCONV: "1"
    }
  });

  ptyProcess.onData((chunk) => emitOutput(scenarioId, chunk));
  ptyProcess.onExit(() => {
    sessions.delete(scenarioId);
    shellKinds.delete(scenarioId);
  });

  sessions.set(scenarioId, ptyProcess);
  shellKinds.set(scenarioId, shell.kind);
  return ptyProcess;
}

export function getPtyShellKind(scenarioId) {
  return shellKinds.get(scenarioId) || null;
}

export function registerOutputListener(scenarioId, callback) {
  const scenarioListeners = listeners.get(scenarioId) || new Set();
  scenarioListeners.add(callback);
  listeners.set(scenarioId, scenarioListeners);

  return () => {
    const current = listeners.get(scenarioId);
    if (!current) return;
    current.delete(callback);
    if (current.size === 0) {
      listeners.delete(scenarioId);
    }
  };
}

export function resizePty(scenarioId, cols, rows) {
  const session = sessions.get(scenarioId);
  if (!session) return;

  const safeCols = Math.max(20, Number(cols) || 120);
  const safeRows = Math.max(8, Number(rows) || 30);
  session.resize(safeCols, safeRows);
}

