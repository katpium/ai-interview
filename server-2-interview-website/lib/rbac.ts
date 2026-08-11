/**
 * RBAC — Role-Based Access Control
 *
 * To add a new role (e.g. "hr", "technician"):
 *   1. Add the role name to the `Role` type.
 *   2. Add a row to ROLE_PERMISSIONS with the permissions it should have.
 *   3. Add the user to AUTH_USERS in .env.local with the new role name.
 *   Done — no middleware changes needed.
 *
 * To add a new protected resource:
 *   1. Add a permission to the `Permission` type.
 *   2. Add it to relevant roles in ROLE_PERMISSIONS.
 *   3. Add the route → permission mapping to ROUTE_PERMISSIONS below.
 */

// ─── Permissions ─────────────────────────────────────────────────────
// Each permission represents one specific action on one resource.

export type Permission =
  | "review:access"        // access the /review page
  | "sessions:list"        // GET /api/sessions — list all candidate sessions
  | "sessions:read"        // GET /api/sessions/:id — read one session
  | "eval:read"            // GET /api/evaluate-interview — load saved evaluation
  | "eval:generate"        // POST /api/evaluate-interview — run AI evaluation
  | "questions:read"       // GET /api/questions — read question bank
  | "questions:generate"   // POST /api/generate-questions — regenerate question bank
  | "invites:generate"     // generate candidate interview links
  | "invites:list"         // view existing invite links
  | "questions:review"       // view question bank for review
  | "questions:approve"      // approve / reject / edit questions
  | "questions:delete"       // permanently delete rejected questions (admin only)
  | "company-files:manage"   // upload / delete company knowledge files
  | "users:manage"           // future: manage users via UI
  | "transcript:edit"        // edit candidate interview transcripts
  | "decisions:read"         // view hiring decisions
  | "decisions:write"        // set hiring decisions
  | "message-draft:generate"; // generate candidate message drafts

// ─── Roles ───────────────────────────────────────────────────────────

export type Role =
  | "admin"
  | "recruiter"
  | "hr"
  | "technician";

// ─── Role → Permissions mapping ──────────────────────────────────────
// This is the single source of truth. Editing here changes what every
// role can do across the entire application.

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    "review:access",
    "sessions:list",
    "sessions:read",
    "eval:read",
    "eval:generate",
    "questions:read",
    "questions:generate",
    "questions:review",
    "questions:approve",
    "questions:delete",
    "company-files:manage",
    "invites:generate",
    "invites:list",
    "users:manage",
    "transcript:edit",
    "decisions:read",
    "decisions:write",
    "message-draft:generate",
  ],

  recruiter: [
    "review:access",
    "sessions:list",
    "sessions:read",
    "eval:read",
    "eval:generate",
    "questions:read",
    "questions:generate", // recruiters generate questions for the roles they hire for
    "questions:review",
    "questions:approve",
    "invites:generate",
    "invites:list",
    "transcript:edit",
    "decisions:read",
    "decisions:write",
    "message-draft:generate",
  ],

  hr: [
    "review:access",
    "sessions:list",
    "sessions:read",
    "eval:read",
    "eval:generate", // HR can re-evaluate interviews
    "questions:read",
    "questions:generate", // HR can also generate questions for review
    "questions:review",
    "questions:approve",
    "invites:list",
    "transcript:edit",
    "decisions:read",
    "decisions:write",
    "message-draft:generate",
  ],

  technician: [
    "review:access",
    "sessions:list",
    "sessions:read",
    "questions:read",
    "questions:generate",   // can generate but NOT review/approve
    "company-files:manage", // manages company knowledge files
    "decisions:read",       // can view decisions but not set them
  ],
};

// ─── Route → Permission mapping ───────────────────────────────────────
// Maps URL patterns to the permission required to access them.
// The middleware reads this table — adding a new protected route only
// requires adding a row here.

export type RouteRule = {
  pattern: RegExp;
  methods?: string[];       // if omitted, applies to all methods
  permission: Permission;
};

export const ROUTE_PERMISSIONS: RouteRule[] = [
  // UI pages
  { pattern: /^\/review(\/|$)/,                    permission: "review:access" },
  { pattern: /^\/admin(\/|$)/,                     permission: "invites:list" },

  // Session list (GET only — POST is public so candidates can create sessions)
  { pattern: /^\/api\/sessions$/,    methods: ["GET"],  permission: "sessions:list" },

  // Evaluation endpoints
  { pattern: /^\/api\/evaluate-interview/, methods: ["GET"],  permission: "eval:read" },
  { pattern: /^\/api\/evaluate-interview/, methods: ["POST"], permission: "eval:generate" },

  // Question generation
  { pattern: /^\/api\/generate-questions/, permission: "questions:generate" },

  // Invite link management
  { pattern: /^\/api\/admin\/generate-link/,       permission: "invites:generate" },
  { pattern: /^\/api\/admin\/invites/,             permission: "invites:list" },

  // Company file management
  { pattern: /^\/admin\/company-files/,            permission: "company-files:manage" },
  { pattern: /^\/api\/admin\/company-files/,       permission: "company-files:manage" },

  // Question bank review/approval
  { pattern: /^\/admin\/questions/,                permission: "questions:review" },
  { pattern: /^\/api\/question-bank\/question/,    methods: ["PATCH"],  permission: "questions:approve" },
  { pattern: /^\/api\/question-bank\/question/,    methods: ["DELETE"], permission: "questions:delete" },
  { pattern: /^\/api\/question-bank\/rejected/,    methods: ["GET"],    permission: "questions:review" },
  { pattern: /^\/api\/question-bank\/rejected/,    methods: ["DELETE"], permission: "questions:delete" },
  { pattern: /^\/api\/question-bank\/approve-all/, permission: "questions:approve" },
  { pattern: /^\/api\/question-bank/,              permission: "questions:review" },

  // Admin area (other)
  { pattern: /^\/api\/admin\//,                    permission: "users:manage" },

  // Transcript editing
  { pattern: /^\/api\/sessions\/[^/]+\/transcript$/, methods: ["PATCH"], permission: "transcript:edit" },

  // Hiring decisions
  { pattern: /^\/api\/sessions\/[^/]+\/decision$/,   methods: ["GET"],   permission: "decisions:read" },
  { pattern: /^\/api\/sessions\/[^/]+\/decision$/,   methods: ["PUT"],   permission: "decisions:write" },

  // Message drafts
  { pattern: /^\/api\/sessions\/[^/]+\/message-draft$/, methods: ["POST"], permission: "message-draft:generate" },

  // Re-evaluation
  { pattern: /^\/api\/re-evaluate-interview$/, methods: ["POST"], permission: "eval:generate" },
];

// ─── Helper ───────────────────────────────────────────────────────────

export function hasPermission(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role as Role];
  if (!perms) return false;
  return perms.includes(permission);
}

export function getPermissions(role: string): Permission[] {
  return ROLE_PERMISSIONS[role as Role] ?? [];
}
