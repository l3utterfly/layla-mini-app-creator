export const MAX_CONSECUTIVE_TOOL_FAILURES = 8

export function advanceToolFailureBudget(consecutiveFailures: number, succeeded: boolean) {
  const nextConsecutiveFailures = succeeded ? 0 : consecutiveFailures + 1
  return {
    consecutiveFailures: nextConsecutiveFailures,
    exhausted: nextConsecutiveFailures >= MAX_CONSECUTIVE_TOOL_FAILURES,
  }
}
