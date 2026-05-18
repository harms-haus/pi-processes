import type { StartupResult } from "../types.js";

export function formatStartupResult(verb: "started" | "restarted", result: StartupResult): string {
  const startupTimeSec = (result.startupTime / 1000).toFixed(1);
  const maxLogDelaySec = result.maxDelay;
  return `Process '${result.name}' ${verb} (PID ${result.pid}).\nStartup time: ${startupTimeSec}s\nMax log delay: ${maxLogDelaySec}s\n\n${result.logs || "(no output)"}`;
}
