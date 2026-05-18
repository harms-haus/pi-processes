/**
 * Format a millisecond duration as HH:MM:SS.mmm (elapsed time string).
 * Pads hours, minutes, seconds to 2 digits and milliseconds to 3 digits.
 *
 * @param ms - Duration in milliseconds (must be >= 0)
 * @returns Formatted string like "00:01:23.456"
 */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");

  return `${hours}:${minutes}:${seconds}.${millis}`;
}

/**
 * Format a LogEntry timestamp (ms since process start) as a readable elapsed time.
 * Prepends a '+' sign to indicate it's relative time.
 *
 * @param ms - Timestamp in ms since process start
 * @returns Formatted string like "+00:01:23.456"
 */
export function formatLogTimestamp(ms: number): string {
  return `+${formatTimestamp(ms)}`;
}
