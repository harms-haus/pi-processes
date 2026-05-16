import { Container, Text } from "@earendil-works/pi-tui";
import { DEFAULT_START_DELAY, RestartProcessSchema } from "../types.js";
import { formatStartupResult } from "./format-startup-result.js";
import type { ProcessManager } from "../process-manager.js";
import type { StartupResult } from "../types.js";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export function createRestartProcessTool(
	getManager: () => ProcessManager,
): ToolDefinition<typeof RestartProcessSchema, StartupResult> {
	return {
		name: "restart_process",
		label: "Restart Process",
		description:
			"Restart a managed process. Kills the existing process first, then starts with the same command (or a new one if provided).",
		promptSnippet: "Restart a managed process",
		promptGuidelines: [
			"Use restart_process to restart a managed process.",
			"If command is not provided, restart uses the previous command.",
		],
		parameters: RestartProcessSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const delay = params.start_delay ?? DEFAULT_START_DELAY;
			const result = await getManager().restart(
				params.name,
				params.command,
				delay,
			);
			return {
				content: [
					{
						type: "text",
						text: formatStartupResult("restarted", result),
					},
				],
				details: result,
			};
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("warning", theme.bold("restart_process ")) +
					theme.fg("accent", args.name),
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const details = result.details as StartupResult;
			const container = new Container();
			container.addChild(
				new Text(
					theme.fg("success", theme.bold(`↻ ${details.name}`)) +
						theme.fg(
							"dim",
							` PID ${details.pid} | restarted in ${(details.startupTime / 1000).toFixed(1)}s`,
						),
					0,
					0,
				),
			);
			return container;
		},
	};
}
