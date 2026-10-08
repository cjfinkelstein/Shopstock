// Fixed set of techs Ray can assign calendar tasks to (see TeamCalendar.tsx
// and api/app/routers/calendar.py's require_calendar_editor). Shared here
// so the tech-facing clock-out checklist and the Team Calendar page agree
// on exactly who this applies to, instead of two copies of the same list
// drifting apart.
export const ASSIGNEES = ["Adam", "Ed", "Avigdor"];

export function isAssignee(name: string | null | undefined): boolean {
  const first = name?.trim().split(/\s+/)[0]?.toLowerCase();
  return ASSIGNEES.some((a) => a.toLowerCase() === first);
}
