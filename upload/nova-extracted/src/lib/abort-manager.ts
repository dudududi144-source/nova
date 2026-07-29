// Abort manager — allows stopping server-side pipeline execution
const abortedMissions = new Set<string>();

export function abortMission(missionId: string) {
  abortedMissions.add(missionId);
}

export function isAborted(missionId: string): boolean {
  return abortedMissions.has(missionId);
}

export function clearAbort(missionId: string) {
  abortedMissions.delete(missionId);
}
