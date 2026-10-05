/**
 * Whether a walk is running on this page. A link opened from outside the page (src/features/native/native-shell.tsx)
 * asks before leaving it; tour-experience.tsx keeps the flag in step with its session.
 */
let walkInProgress = false;

export function setWalkInProgress(value: boolean): void {
  walkInProgress = value;
}

export function isWalkInProgress(): boolean {
  return walkInProgress;
}
