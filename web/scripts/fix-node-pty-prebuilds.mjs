/**
 * node-pty macOS/Linux prebuilds ship spawn-helper without the execute bit (see
 * https://github.com/microsoft/node-pty/issues/850). Without +x, pty.spawn fails with
 * "posix_spawnp failed" and the Web UI terminal disconnects immediately.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prebuilds = path.resolve(__dirname, "../node_modules/node-pty/prebuilds");

if (!fs.existsSync(prebuilds)) {
  process.exit(0);
}

for (const entry of fs.readdirSync(prebuilds, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const helper = path.join(prebuilds, entry.name, "spawn-helper");
  if (!fs.existsSync(helper)) continue;
  try {
    fs.chmodSync(helper, 0o755);
  } catch {
    /* ignore */
  }
}
