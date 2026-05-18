import { vi } from 'vitest';

/**
 * Create a mock theme object with consistent default behavior.
 *
 * Uses the `<color>text</color>` format for fg, `**text**` for bold,
 * matching the start-process.test.ts pattern.
 *
 * All style methods are vi.fn() so you can assert on calls.
 */
export function createMockTheme() {
  return {
    fg: vi.fn((color: string, text: string) => `<${color}>${text}</${color}>`),
    bg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => `**${text}**`),
    italic: vi.fn((text: string) => text),
    underline: vi.fn((text: string) => text),
    inverse: vi.fn((text: string) => text),
    strikethrough: vi.fn((text: string) => text),
  };
}

/** The shape of the object returned by createMockTheme */
export type MockTheme = ReturnType<typeof createMockTheme>;
