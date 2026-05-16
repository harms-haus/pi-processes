import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import type { ProcessManager } from "../process-manager.js";
import type { ProcessInfo } from "../types.js";
import { ListProcessesSchema } from "../types.js";

export interface ListProcessesResult {
	processes: ProcessInfo[];
	count: number;
}

export function createListProcessesTool(
	getManager: () => ProcessManager,
): ToolDefinition<typeof ListProcessesSchema, ListProcessesResult> {
	return {
		name: "list_processes",
		label: "List Processes",
		description: "List all active managed processes with their status.",
		promptSnippet: "List active managed processes",
		promptGuidelines: [
			"Use list_processes to see all running managed processes.",
		],
		parameters: ListProcessesSchema,
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			const processes = getManager().list();
			const text =
				processes.length === 0
					? "No active processes."
					: processes
							.map(
								(p) =>
									`${p.name} (PID ${p.pid}) | ${p.command} | uptime: ${p.uptimeSec.toFixed(1)}s | ${p.logLines} lines | ${p.startupComplete ? "ready" : "starting"}`,
							)
							.join("\n");
			return {
				content: [{ type: "text", text }],
				details: { processes, count: processes.length },
			};
		},
		renderCall(_args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("list_processes")),
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const details = result.details as ListProcessesResult;
			const container = new Container();
			container.addChild(
				new Text(
					theme.fg("toolTitle", theme.bold("list_processes")) +
						theme.fg(
							"dim",
							` — ${details.count} process${details.count !== 1 ? "es" : ""}`,
						),
					0,
					0,
				),
			);
			if (details.count > 0) {
				container.addChild(new Spacer(1));
				for (const p of details.processes) {
					container.addChild(
						new Text(
							theme.fg("success", `● ${p.name}`) +
								theme.fg("dim", ` PID ${p.pid} | ${p.uptimeSec.toFixed(0)}s`),
							0,
							0,
						),
					);
				}
			}
			return container;
		},
	};
}
