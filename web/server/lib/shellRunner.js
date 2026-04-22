import { exec } from "child_process";
import fs from "fs";
import path from "path";

const GIT_BASH = "C:/Program Files/Git/bin/bash.exe";

function toPosixPath(value) {
  return path.resolve(value).replace(/\\/g, "/");
}

export function runShellCommand(command, options = {}) {
  const { cwd, env = {} } = options;
  const mergedEnv = { ...process.env, MSYS_NO_PATHCONV: "1", ...env };

  if (process.platform === "win32" && fs.existsSync(GIT_BASH)) {
    const escaped = command.replace(/"/g, '\\"');
    const full = `"${GIT_BASH}" -lc "${escaped}"`;
    return new Promise((resolve) => {
      exec(full, { cwd, env: mergedEnv }, (error, stdout, stderr) => {
        resolve({
          code: error?.code ?? 0,
          stdout: stdout || "",
          stderr: stderr || ""
        });
      });
    });
  }

  return new Promise((resolve) => {
    exec(command, { cwd, env: mergedEnv, shell: process.platform === "win32" ? true : "/bin/sh" }, (error, stdout, stderr) => {
      resolve({
        code: error?.code ?? 0,
        stdout: stdout || "",
        stderr: stderr || ""
      });
    });
  });
}

export { toPosixPath };
