import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Custom grok sandbox profile installed by `setup --allow-network`: the
// built-in read-only filesystem rules, but child processes keep network access.
export const NETWORK_PROFILE_NAME = "grok-cc-read-only-net";
const SANDBOX_FILE_NAME = "sandbox.toml";
const PROFILE_HEADER = `[profiles.${NETWORK_PROFILE_NAME}]`;
const PROFILE_BLOCK = [
  "# Added by the grok-cc Claude Code plugin (/grok-cc:setup --allow-network).",
  "# Read-only filesystem like the built-in profile, but child processes may use the network.",
  PROFILE_HEADER,
  'extends = "read-only"',
  "restrict_network = false",
  ""
].join("\n");

export function resolveGrokHome(env = process.env) {
  const override = env.GROK_HOME?.trim();
  return override || path.join(os.homedir(), ".grok");
}

export function resolveSandboxFile(env = process.env) {
  return path.join(resolveGrokHome(env), SANDBOX_FILE_NAME);
}

function hasProfile(content) {
  const pattern = new RegExp(`^\\s*\\[profiles\\.${NETWORK_PROFILE_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`, "m");
  return pattern.test(content);
}

// Appends the network profile to the user's sandbox.toml unless it is already
// defined there. Existing content is never rewritten.
export function ensureNetworkProfile(env = process.env) {
  const file = resolveSandboxFile(env);
  let existing = "";
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (hasProfile(existing)) {
    return { file, profile: NETWORK_PROFILE_NAME, created: false };
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const separator = existing.length === 0 || existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(file, `${existing}${separator}${PROFILE_BLOCK}`, "utf8");
  return { file, profile: NETWORK_PROFILE_NAME, created: true };
}
