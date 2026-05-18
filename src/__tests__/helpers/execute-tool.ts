import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

/**
 * Call tool.execute() with the standard stubs for unused params.
 *
 * Tests always pass `undefined, undefined, undefined as any` for signal,
 * onUpdate, and ctx. This helper DRYs that up.
 */
export async function executeTool<TParams>(
  tool: Pick<ToolDefinition<any>, 'execute'>,
  callId: string,
  params: TParams,
) {
  return tool.execute(callId, params, undefined, undefined, undefined as any);
}
