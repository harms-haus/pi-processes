import { Container, Text } from "@earendil-works/pi-tui";
import { type LogQueryOptions, queryLogs } from "../process-logs.js";
import { ProcessLogsSchema } from "../types.js";
import type { ProcessManager } from "../process-manager.js";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

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
			"Read log output from a managed process. Use head/tail for line counts, start/end for line ranges, and grep to filter by pattern.",
		promptSnippet: "Read logs from a managed process",
		promptGuidelines: [
			"Use process_logs with head=N to get first N lines.",
			"Use process_logs with tail=N to get last N lines.",
			"Use process_logs with start and end for a line range (1-indexed).",
			'Use process_logs with grep="pattern" to filter log lines by regex pattern.',
			"Set grepLiteral=true to treat the grep pattern as a literal string.",
			"Set grepIgnoreCase=true for case-insensitive grep matching.",
			"grep can be combined with head/tail/start+end to slice filtered results.",
		],
		parameters: ProcessLogsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const logs = getManager().getLogs(params.name);
			const queryOptions: LogQueryOptions = {};
			if (params.head !== undefined) {queryOptions.head = params.head;}
			if (params.tail !== undefined) {queryOptions.tail = params.tail;}
			if (params.start !== undefined) {queryOptions.start = params.start;}
			if (params.end !== undefined) {queryOptions.end = params.end;}
			if (params.grep) {queryOptions.grep = params.grep;}
			if (params.grepLiteral) {queryOptions.grepLiteral = params.grepLiteral;}
			if (params.grepIgnoreCase)
				{queryOptions.grepIgnoreCase = params.grepIgnoreCase;}

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
			const grepPart = args.grep
				? theme.fg("dim", `grep(${JSON.stringify(args.grep)})`)
				: "";

			const positionalMode = args.head
				? `head(${args.head})`
				: args.tail
					? `tail(${args.tail})`
					: args.start
						? `[${args.start}-${args.end ?? "end"}]`
						: grepPart
							? ""
							: "all";

			const separator = grepPart && positionalMode ? " + " : "";
			const modeStr =
				grepPart +
				separator +
				(positionalMode ? theme.fg("dim", positionalMode) : "");

			return new Text(
				theme.fg("toolTitle", theme.bold("process_logs ")) +
					theme.fg("accent", args.name) +
					(modeStr ? ` ${modeStr}` : ""),
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
