export type MissionType =
  | "genesis"    // 全新專案或功能建立
  | "renovate"   // 既有功能重構或改善
  | "medic"      // 緊急修復（hotfix）
  | "exodus"     // 功能移除或遷移
  | "guardian";  // 維護性工作（deps 更新、安全性修補）

export type MissionStatus =
  | "PLANNING"
  | "IN_PROGRESS"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED";

export interface MissionRecord {
  id: string;
  type: MissionType;
  intent: string;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  pausedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}

export const VALID_MISSION_TYPES: MissionType[] = [
  "genesis",
  "renovate",
  "medic",
  "exodus",
  "guardian",
];

export function isMissionType(value: string): value is MissionType {
  return VALID_MISSION_TYPES.includes(value as MissionType);
}
