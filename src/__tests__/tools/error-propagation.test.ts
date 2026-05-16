import { describe, expect, it } from "vitest";
import { createStartProcessTool } from "../../tools/start-process.js";
import { createKillProcessTool } from "../../tools/kill-process.js";
import { createRestartProcessTool } from "../../tools/restart-process.js";
import { createProcessLogsTool } from "../../tools/process-logs.js";
import { createListProcessesTool } from "../../tools/list-processes.js";
import {
	createMockManager,
	executeTool,
} from "../helpers/index.js";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("tool error propagation", () => {
	// 1. start-process: manager.start rejects → execute rejects with same error
	it("start-process propagates error from manager.start", async () => {
		const manager = createMockManager();
		manager.start.mockRejectedValue(new Error("already exists"));
		const tool = createStartProcessTool(() => manager as any);

		await expect(
			executeTool(tool, "call-1", { name: "dup", command: "npm start" }),
		).rejects.toThrow("already exists");
	});

	// 2. kill-process: manager.kill rejects → execute rejects with same error
	it("kill-process propagates error from manager.kill", async () => {
		const manager = createMockManager();
		manager.kill.mockRejectedValue(new Error("not found"));
		const tool = createKillProcessTool(() => manager as any);

		await expect(
			executeTool(tool, "call-2", { name: "missing" }),
		).rejects.toThrow("not found");
	});

	// 3. restart-process: manager.restart rejects → execute rejects with same error
	it("restart-process propagates error from manager.restart", async () => {
		const manager = createMockManager();
		manager.restart.mockRejectedValue(new Error("No command specified"));
		const tool = createRestartProcessTool(() => manager as any);

		await expect(
			executeTool(tool, "call-3", { name: "broken" } as any),
		).rejects.toThrow("No command specified");
	});

	// 4. process-logs: manager.getLogs throws → execute rejects with same error
	it("process-logs propagates error from manager.getLogs", async () => {
		const manager = createMockManager();
		manager.getLogs.mockImplementation(() => {
			throw new Error("not found");
		});
		const tool = createProcessLogsTool(() => manager as any);

		await expect(
			executeTool(tool, "call-4", { name: "missing" }),
		).rejects.toThrow("not found");
	});

	// 5. list-processes: manager.list throws → execute rejects with same error
	it("list-processes propagates error from manager.list", async () => {
		const manager = createMockManager();
		manager.list.mockImplementation(() => {
			throw new Error("internal error");
		});
		const tool = createListProcessesTool(() => manager as any);

		await expect(
			executeTool(tool, "call-5", {}),
		).rejects.toThrow("internal error");
	});
});
