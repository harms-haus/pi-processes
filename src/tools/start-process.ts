import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import type { ProcessManager } from "../process-manager.js";
import type { StartupResult } from "../types.js";
import { DEFAULT_START_DELAY, StartProcessSchema } from "../types.js";
import { formatStartupResult } from "./format-startup-result.js";

export function createStartProcessTool(
	getManager: () => ProcessManager,
): ToolDefinition<typeof StartProcessSchema, StartupResult> {
	return {
		name: "start_process",
		label: "Start Process",
		description:
			"Start a long-running process (e.g., debug server, API server). Waits for startup logs to settle before returning.",
		promptSnippet: "Start a managed process with startup debounce",
		promptGuidelines: [
			"Use start_process to start servers, watchers, or long-running commands.",
			"start_process returns startup logs once output has been quiet for start_delay seconds.",
		],
		parameters: StartProcessSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const delay = params.start_delay ?? DEFAULT_START_DELAY;
			const result = await getManager().start(
				params.name,
				params.command,
				delay,
			);
			return {
				content: [
					{
						type: "text",
						text: formatStartupResult("started", result),
					},
				],
				details: result,
			};
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("start_process ")) +
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
					theme.fg("success", theme.bold(`✓ ${details.name}`)) +
						theme.fg("dim", ` PID ${details.pid}`) +
						theme.fg(
							"dim",
							` | startup ${(details.startupTime / 1000).toFixed(1)}s`,
						),
					0,
					0,
				),
			);
			return container;
		},
	};
}
