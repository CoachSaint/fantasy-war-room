import { z } from "zod";
import type {
  LeagueContext,
  Player,
  Position,
  RosterSlotDefinition,
  RosterSlotType,
  ScoringProfile,
} from "@/lib/types";

const positions = ["QB", "RB", "WR", "TE", "K", "DST"] as const satisfies readonly Position[];
const slotTypes = [
  "QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "WR_RB", "WR_TE", "K", "DST", "BENCH", "IR", "TAXI",
] as const satisfies readonly RosterSlotType[];

const coefficient = z.number().finite();
const passingScoring = z.object({
  passYard: coefficient,
  passTd: coefficient,
  interception: coefficient,
  completion: coefficient,
  incompletion: coefficient,
  twoPoint: coefficient,
  bonus300: coefficient,
  bonus400: coefficient,
}).partial().strict();
const rushingScoring = z.object({
  rushYard: coefficient,
  rushTd: coefficient,
  firstDown: coefficient,
  bonus100: coefficient,
  bonus200: coefficient,
  twoPoint: coefficient,
}).partial().strict();
const receivingScoring = z.object({
  reception: coefficient,
  receptionByPosition: z.record(z.enum(positions), coefficient).or(z.record(z.string(), coefficient)),
  receivingYard: coefficient,
  receivingTd: coefficient,
  firstDown: coefficient,
  twoPoint: coefficient,
  bonus100: coefficient,
  bonus200: coefficient,
}).partial().strict();
const miscScoring = z.object({
  fumble: coefficient,
  fumbleLost: coefficient,
  returnYard: coefficient,
  returnTd: coefficient,
}).partial().strict();

const scoringSchema = z.object({
  preset: z.enum(["standard", "half_ppr", "ppr", "custom"]).optional(),
  passing: passingScoring.optional(),
  rushing: rushingScoring.optional(),
  receiving: receivingScoring.optional(),
  misc: miscScoring.optional(),
  kicking: z.record(z.string(), coefficient).optional(),
  defense: z.record(z.string(), coefficient).optional(),
  bonuses: z.record(z.string(), coefficient).optional(),
}).strict().superRefine((value, context) => {
  const hasCoefficients = Object.keys(value).some((key) => key !== "preset");
  if (!value.preset && !hasCoefficients) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scoring"], message: "exact scoring coefficients or a preset are required" });
  }
});

const leagueBasicsSchema = z.object({
  leagueId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  season: z.number().int().min(2000).max(2100),
  week: z.number().int().min(0).max(23),
  teamCount: z.number().int().min(2).max(32),
  benchSlots: z.number().int().min(0).max(20).optional(),
  irSlots: z.number().int().min(0).max(10).optional(),
  taxiSlots: z.number().int().min(0).max(10).optional(),
}).strict();

const slotSchema = z.object({
  id: z.string().trim().min(1).optional(),
  slotType: z.enum(slotTypes),
  slotOrder: z.number().int().min(0),
  eligiblePositions: z.array(z.enum(positions)).min(1),
  required: z.boolean().optional(),
  count: z.number().int().min(1).max(20).optional(),
}).strict();

const teamSchema = z.object({ id: z.string().trim().min(1), name: z.string().trim().min(1) }).strict();
const managerSchema = z.object({ managerId: z.string().trim().min(1), displayName: z.string().trim().min(1) }).strict();
const mappingSchema = z.object({ teamId: z.string().trim().min(1), managerId: z.string().trim().min(1) }).strict();
const assignmentSchema = z.object({ playerId: z.string().trim().min(1), teamId: z.string().trim().min(1) }).strict();

export const leagueSetupInputSchema = z.object({
  league: leagueBasicsSchema,
  scoring: scoringSchema,
  rosterSlots: z.array(slotSchema).min(1),
  teams: z.array(teamSchema),
  managers: z.array(managerSchema),
  managerMappings: z.array(mappingSchema),
  knownPlayerIds: z.array(z.string().trim().min(1)),
  playerAssignments: z.array(assignmentSchema),
}).strict();

export type LeagueSetupInput = z.input<typeof leagueSetupInputSchema>;

export interface CanonicalLeagueSetup {
  league: z.infer<typeof leagueBasicsSchema>;
  scoring: ScoringProfile;
  rosterSlots: RosterSlotDefinition[];
  teams: Array<{ id: string; name: string }>;
  managers: Array<{ managerId: string; displayName: string }>;
  managerMappings: Array<{ teamId: string; managerId: string }>;
  playerAssignments: Array<{ playerId: string; teamId: string }>;
  /** Sorted, duplicate-free provider ids used to resolve assignments. */
  knownPlayerIds: string[];
  fingerprint: string;
}

export interface LeagueSetupIssue {
  code: string;
  path: Array<string | number>;
  message: string;
}

export interface LeagueSetupVerification {
  ok: boolean;
  errors: LeagueSetupIssue[];
  warnings: LeagueSetupIssue[];
  canonical?: CanonicalLeagueSetup;
  fingerprint: string;
}

export class LeagueSetupValidationError extends Error {
  constructor(public readonly issues: LeagueSetupIssue[]) {
    super("League setup failed validation");
    this.name = "LeagueSetupValidationError";
  }
}

const allowedSlotPositions: Record<RosterSlotType, Position[]> = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DST: ["DST"],
  FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  WR_RB: ["WR", "RB"], WR_TE: ["WR", "TE"],
  BENCH: [...positions], IR: [...positions], TAXI: [...positions],
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  const text = JSON.stringify(stableValue(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `setup_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function issue(code: string, path: Array<string | number>, message: string): LeagueSetupIssue {
  return { code, path, message };
}

function uniqueness(values: string[], path: string, code: string, errors: LeagueSetupIssue[]): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const key = value.toLowerCase();
    if (seen.has(key)) errors.push(issue(code, [path, index], `duplicate value: ${value}`));
    seen.add(key);
  });
}

function toIssues(error: z.ZodError): LeagueSetupIssue[] {
  return error.issues.map((entry) => ({
    code: entry.code,
    path: entry.path.map((part) => typeof part === "symbol" ? String(part) : part),
    message: entry.message,
  }));
}

export function canonicalizeLeagueSetup(input: unknown): CanonicalLeagueSetup {
  const parsed = leagueSetupInputSchema.safeParse(input);
  if (!parsed.success) throw new LeagueSetupValidationError(toIssues(parsed.error));
  const value = parsed.data;
  const errors: LeagueSetupIssue[] = [];
  const teamIds = value.teams.map((team) => team.id);
  const teamNames = value.teams.map((team) => team.name);
  const managerIds = value.managers.map((manager) => manager.managerId);
  const mappingTeamIds = value.managerMappings.map((mapping) => mapping.teamId);
  const assignmentIds = value.playerAssignments.map((assignment) => assignment.playerId);

  if (value.teams.length !== value.league.teamCount) errors.push(issue("team_count_mismatch", ["teams"], `expected ${value.league.teamCount} teams, received ${value.teams.length}`));
  uniqueness(teamIds, "teams", "duplicate_team_id", errors);
  uniqueness(teamNames, "teams", "duplicate_team_name", errors);
  uniqueness(managerIds, "managers", "duplicate_manager_id", errors);
  uniqueness(mappingTeamIds, "managerMappings", "duplicate_manager_mapping", errors);
  uniqueness(assignmentIds, "playerAssignments", "duplicate_player_assignment", errors);

  const teamSet = new Set(teamIds);
  const managerSet = new Set(managerIds);
  const knownPlayerSet = new Set(value.knownPlayerIds);
  value.managerMappings.forEach((mapping, index) => {
    if (!teamSet.has(mapping.teamId)) errors.push(issue("unknown_team", ["managerMappings", index, "teamId"], `unknown team: ${mapping.teamId}`));
    if (!managerSet.has(mapping.managerId)) errors.push(issue("unknown_manager", ["managerMappings", index, "managerId"], `unknown manager: ${mapping.managerId}`));
  });
  uniqueness(value.managerMappings.map((mapping) => mapping.managerId), "managerMappings", "duplicate_manager_mapping", errors);
  value.teams.forEach((team, index) => {
    if (!value.managerMappings.some((mapping) => mapping.teamId === team.id)) errors.push(issue("missing_manager_mapping", ["teams", index], `team ${team.id} has no manager mapping`));
  });
  value.managers.forEach((manager, index) => {
    if (!value.managerMappings.some((mapping) => mapping.managerId === manager.managerId)) errors.push(issue("unmapped_manager", ["managers", index], `manager ${manager.managerId} has no team mapping`));
  });
  value.playerAssignments.forEach((assignment, index) => {
    if (!teamSet.has(assignment.teamId)) errors.push(issue("unknown_team", ["playerAssignments", index, "teamId"], `unknown team: ${assignment.teamId}`));
    if (!knownPlayerSet.has(assignment.playerId)) errors.push(issue("unresolved_player", ["playerAssignments", index, "playerId"], `player is not in the known player pool: ${assignment.playerId}`));
  });
  if (new Set(value.knownPlayerIds.map((id) => id.toLowerCase())).size !== value.knownPlayerIds.length) errors.push(issue("duplicate_known_player", ["knownPlayerIds"], "known player ids must be unique"));

  const slotIds = value.rosterSlots.map((slot) => slot.id).filter((id): id is string => Boolean(id));
  uniqueness(slotIds, "rosterSlots", "duplicate_slot_id", errors);
  const slotOrders = new Set<number>();
  value.rosterSlots.forEach((slot, index) => {
    if (slotOrders.has(slot.slotOrder)) errors.push(issue("duplicate_slot_order", ["rosterSlots", index, "slotOrder"], `slot order ${slot.slotOrder} is repeated`));
    slotOrders.add(slot.slotOrder);
    const expected = allowedSlotPositions[slot.slotType];
    const actual = [...new Set(slot.eligiblePositions)];
    if (actual.length !== slot.eligiblePositions.length || actual.length !== expected.length || actual.some((position) => !expected.includes(position))) {
      errors.push(issue("illegal_slot_positions", ["rosterSlots", index, "eligiblePositions"], `${slot.slotType} cannot accept ${slot.eligiblePositions.join(", ")}`));
    }
    const shouldRequire = !["BENCH", "IR", "TAXI"].includes(slot.slotType);
    if (slot.required === true && !shouldRequire) errors.push(issue("illegal_slot_requirement", ["rosterSlots", index, "required"], `${slot.slotType} cannot be required`));
  });

  if (errors.length) throw new LeagueSetupValidationError(errors);

  const rosterSlots = [...value.rosterSlots]
    .sort((a, b) => a.slotOrder - b.slotOrder || a.slotType.localeCompare(b.slotType))
    .map((slot, index) => ({
      ...slot,
      id: slot.id || `slot_${index + 1}`,
      count: slot.count ?? 1,
      required: slot.required ?? !["BENCH", "IR", "TAXI"].includes(slot.slotType),
      eligiblePositions: [...slot.eligiblePositions],
    }));
  const canonicalWithoutFingerprint = {
    league: value.league,
    scoring: stableValue(value.scoring) as ScoringProfile,
    rosterSlots,
    teams: [...value.teams].sort((a, b) => a.id.localeCompare(b.id)),
    managers: [...value.managers].sort((a, b) => a.managerId.localeCompare(b.managerId)),
    managerMappings: [...value.managerMappings].sort((a, b) => a.teamId.localeCompare(b.teamId)),
    playerAssignments: [...value.playerAssignments].sort((a, b) => a.playerId.localeCompare(b.playerId)),
    knownPlayerIds: [...value.knownPlayerIds].sort(),
  };
  return { ...canonicalWithoutFingerprint, fingerprint: fingerprint(canonicalWithoutFingerprint) };
}

export function verifyLeagueSetup(input: unknown): LeagueSetupVerification {
  try {
    const canonical = canonicalizeLeagueSetup(input);
    return { ok: true, errors: [], warnings: [], canonical, fingerprint: canonical.fingerprint };
  } catch (error) {
    const errors = error instanceof LeagueSetupValidationError ? error.issues : [issue("invalid_setup", [], "league setup is invalid")];
    return { ok: false, errors, warnings: [], fingerprint: fingerprint({ errors }) };
  }
}

export function leagueSetupToContext(setup: CanonicalLeagueSetup, rosterPlayerIds: string[] = []): LeagueContext {
  const assigned = new Set(setup.playerAssignments.map((assignment) => assignment.playerId));
  return {
    leagueId: setup.league.leagueId,
    season: setup.league.season,
    week: setup.league.week,
    scoring: setup.scoring,
    rosterPositions: setup.rosterSlots.map((slot) => slot.slotType),
    rosterSlots: setup.rosterSlots,
    rosterPlayerIds: [...new Set(rosterPlayerIds)].filter((id) => assigned.has(id)),
    availablePlayerIds: setup.knownPlayerIds.filter((id) => !assigned.has(id)),
    teamCount: setup.league.teamCount,
    benchSlots: setup.league.benchSlots,
    irSlots: setup.league.irSlots,
    taxiSlots: setup.league.taxiSlots,
  };
}

/** Keep this import in the service's public contract for callers using player DTOs. */
export type LeagueSetupPlayer = Pick<Player, "id" | "fullName" | "position">;
