import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import type { ProcessManager } from "../process-manager.js";
import type { KillResult } from "../types.js";
import { KillProcessSchema } from "../types.js";

export function createKillProcessTool(
	getManager: () => ProcessManager,
): ToolDefinition<typeof KillProcessSchema, KillResult> {
	return {
		name: "kill_process",
		label: "Kill Process",
		description:
			"Kill a running managed process by name. Returns total runtime.",
		promptSnippet: "Kill a managed process",
		promptGuidelines: [
			"Use kill_process to stop a managed process by name.",
			"kill_process returns the total runtime of the killed process.",
		],
		parameters: KillProcessSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await getManager().kill(params.name);
			const totalRuntimeSec = result.totalRuntime / 1000;
			return {
				content: [
					{
						type: "text",
						text: `Process '${result.name}' killed (PID ${result.pid}). Total runtime: ${totalRuntimeSec.toFixed(1)}s`,
					},
				],
				details: result,
			};
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("warning", theme.bold("kill_process ")) +
					theme.fg("accent", args.name),
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const details = result.details as KillResult;
			const totalRuntimeSec = details.totalRuntime / 1000;
			const container = new Container();
			container.addChild(
				new Text(
					theme.fg("error", theme.bold(`✗ ${details.name}`)) +
						theme.fg(
							"dim",
							` PID ${details.pid} | runtime ${totalRuntimeSec.toFixed(1)}s`,
						),
					0,
					0,
				),
			);
			return container;
		},
	};
}
