import type { Recommendation } from "@/lib/types";

const now = new Date();
const fresh = new Date(now.getTime() + 4 * 60 * 60 * 1000);

export const demoRecommendations: Recommendation[] = [
  {
    id: "demo-1",
    kind: "add",
    subjectPlayerId: "p1",
    score: 89,
    confidence: 86,
    headline: "Add the emerging WR before waivers close",
    reasonCodes: ["ROLE_UP", "TARGET_SHARE_UP", "ROS_VALUE"],
    evidenceIds: ["ev-1", "ev-2"],
    computedAt: now.toISOString(),
    freshUntil: fresh.toISOString(),
    engineVersion: "war-v0.1.0",
  },
  {
    id: "demo-2",
    kind: "start",
    subjectPlayerId: "p2",
    alternativePlayerId: "p3",
    score: 84,
    confidence: 91,
    headline: "Start the higher-volume back",
    reasonCodes: ["OPPORTUNITY_EDGE", "FLOOR_EDGE"],
    evidenceIds: ["ev-3"],
    computedAt: now.toISOString(),
    freshUntil: fresh.toISOString(),
    engineVersion: "war-v0.1.0",
  },
  {
    id: "demo-3",
    kind: "watch",
    subjectPlayerId: "p4",
    score: 76,
    confidence: 72,
    headline: "Watch this depth-chart move",
    reasonCodes: ["SNAP_SHARE_UP", "ROLE_UNCERTAIN"],
    evidenceIds: ["ev-4"],
    computedAt: now.toISOString(),
    freshUntil: fresh.toISOString(),
    engineVersion: "war-v0.1.0",
  },
];
