import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import type { ProcessManager } from "../process-manager.js";
import { ProcessLogsSchema } from "../types.js";
import { queryLogs, type LogQueryOptions } from "../process-logs.js";

export interface ProcessLogsResult {
	logs: string;
	totalLines: number;
	returnedLines: number;
}

export function createProcessLogsTool(
	getManager: () => ProcessManager,
): ToolDefinition<typeof ProcessLogsSchema, ProcessLogsResult> {
	return {
		name: "process_logs",
		label: "Process Logs",
		description:
			"Read log output from a managed process. Use head/tail for line counts, or start/end for line ranges.",
		promptSnippet: "Read logs from a managed process",
		promptGuidelines: [
			"Use process_logs with head=N to get first N lines.",
			"Use process_logs with tail=N to get last N lines.",
			"Use process_logs with start and end for a line range (1-indexed).",
		],
		parameters: ProcessLogsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			// Validate mutually exclusive options
			const hasHead = params.head !== undefined;
			const hasTail = params.tail !== undefined;
			const hasStart = params.start !== undefined;
			const hasEnd = params.end !== undefined;

			if (
				(hasHead && hasTail) ||
				(hasHead && hasStart) ||
				(hasHead && hasEnd) ||
				(hasTail && hasStart) ||
				(hasTail && hasEnd)
			) {
				throw new Error(
					"Invalid query: head, tail, and start/end are mutually exclusive",
				);
			}

			const logs = getManager().getLogs(params.name);
			const queryOptions: LogQueryOptions = {};
			if (hasHead) queryOptions.head = params.head;
			if (hasTail) queryOptions.tail = params.tail;
			if (hasStart) queryOptions.start = params.start;
			if (hasEnd) queryOptions.end = params.end;

			const result = queryLogs(logs, queryOptions);
			return {
				content: [{ type: "text", text: result.text || "(no logs)" }],
				details: {
					logs: result.text,
					totalLines: result.totalLines,
					returnedLines: result.returnedLines,
				},
			};
		},
		renderCall(args, theme) {
			const mode = args.head
				? `head(${args.head})`
				: args.tail
					? `tail(${args.tail})`
					: args.start
						? `[${args.start}-${args.end ?? "end"}]`
						: "all";
			return new Text(
				theme.fg("toolTitle", theme.bold("process_logs ")) +
					theme.fg("accent", args.name) +
					theme.fg("dim", ` ${mode}`),
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const details = result.details as ProcessLogsResult;
			const container = new Container();
			container.addChild(
				new Text(
					theme.fg("toolTitle", theme.bold("process_logs")) +
						theme.fg(
							"dim",
							` ${details.returnedLines}/${details.totalLines} lines`,
						),
					0,
					0,
				),
			);
			return container;
		},
	};
}
