export const SYSTEM_ROLES = [
  "SCHOOL_OWNER",
  "ADMIN",
  "ACADEMIC_ADMIN",
  "EXAMINATION_OFFICER",
  "ACCOUNTANT",
  "TEACHER",
  "RECEPTIONIST",
  "SYSTEM_ADMIN",
  "PLATFORM_SUPER_ADMIN",
  "FINANCE_ADMIN",
  "CASHIER",
  "FINANCE_APPROVER",
  "AUDITOR",
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const NAV_PERMISSIONS: Record<SystemRole, string[]> = {
  SCHOOL_OWNER: ["*"],
  ADMIN: ["*"],
  ACADEMIC_ADMIN: [
    "academic-affairs.students",
    "academic-affairs.academics",
    "academic-affairs.attendance",
    "academic-affairs.examination-center",
    "academic-affairs.timetable",
    "academic-affairs.promotion",
    "academic-affairs.reports",
    "academic-affairs.documents",
    "people.staff-attendance",
    "people.departments",
    "people.notifications",
    "people.communication",
  ],
  EXAMINATION_OFFICER: [
    "academic-affairs.examination-center",
    "academic-affairs.reports",
  ],
  ACCOUNTANT: [
    "financial.dashboard",
    "financial.fees",
    "financial.discounts",
    "financial.expenses",
    "financial.reports",
  ],
  TEACHER: [
    "academic-affairs.classes",
    "academic-affairs.timetable",
    "academic-affairs.attendance",
    "academic-affairs.marks",
  ],
  RECEPTIONIST: [
    "academic-affairs.students",
    "academic-affairs.admissions",
    "academic-affairs.enrollments",
    "academic-affairs.guardians",
  ],
  SYSTEM_ADMIN: [
    "system.users",
    "system.school-settings",
    "system.academic-settings",
    "system.financial-settings",
    "system.audit-logs",
    "system.integrations",
  ],
  PLATFORM_SUPER_ADMIN: [
    "system.tenants",
  ],
  FINANCE_ADMIN: [
    "financial.dashboard",
    "financial.fees",
    "financial.payments",
    "financial.discounts",
    "financial.expenses",
    "financial.cash",
    "financial.reports",
    "financial.controls",
    "financial.settings",
  ],
  CASHIER: [
    "financial.dashboard",
    "financial.payments",
    "financial.cash",
  ],
  FINANCE_APPROVER: [
    "financial.dashboard",
    "financial.discounts",
    "financial.expenses",
    "financial.reports",
    "financial.controls",
  ],
  AUDITOR: [
    "financial.dashboard",
    "financial.reports",
    "financial.controls",
  ],
};

export function roleCan(role: string, permission: string): boolean {
  const permissions = NAV_PERMISSIONS[role as SystemRole];
  if (!permissions) return false;
  if (permissions.includes("*")) return true;
  return permissions.includes(permission);
}

// ---------------------------------------------------------------------------
// Fine-grained action permissions (backend-enforced)
// Unlike NAV_PERMISSIONS (used to build the frontend nav), these gate specific
// operations and, for sensitive data such as family-condition reasons, whether
// a field is returned at all.
// ---------------------------------------------------------------------------

export const PERMISSIONS = {
  PAYROLL_VIEW: "finance:payroll:view",
  PAYROLL_MANAGE: "finance:payroll:manage",
  PAYROLL_APPROVE: "finance:payroll:approve",
  SIBLING_MANAGE: "finance:sibling:manage",
  FAMILY_CONDITION_VIEW: "finance:family-condition:view",
  FAMILY_CONDITION_MANAGE: "finance:family-condition:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<SystemRole, string[]> = {
  SCHOOL_OWNER: ["*"],
  ADMIN: ["*"],
  PLATFORM_SUPER_ADMIN: ["*"],
  SYSTEM_ADMIN: [],
  ACADEMIC_ADMIN: [],
  EXAMINATION_OFFICER: [],
  RECEPTIONIST: [],
  TEACHER: [],
  ACCOUNTANT: [
    PERMISSIONS.PAYROLL_VIEW,
    PERMISSIONS.PAYROLL_MANAGE,
    PERMISSIONS.PAYROLL_APPROVE,
    PERMISSIONS.SIBLING_MANAGE,
    PERMISSIONS.FAMILY_CONDITION_VIEW,
    PERMISSIONS.FAMILY_CONDITION_MANAGE,
  ],
  FINANCE_ADMIN: [
    PERMISSIONS.PAYROLL_VIEW,
    PERMISSIONS.PAYROLL_MANAGE,
    PERMISSIONS.SIBLING_MANAGE,
    PERMISSIONS.FAMILY_CONDITION_VIEW,
    PERMISSIONS.FAMILY_CONDITION_MANAGE,
  ],
  FINANCE_APPROVER: [
    PERMISSIONS.PAYROLL_VIEW,
    PERMISSIONS.PAYROLL_APPROVE,
    PERMISSIONS.FAMILY_CONDITION_VIEW,
  ],
  CASHIER: [PERMISSIONS.PAYROLL_VIEW],
  AUDITOR: [PERMISSIONS.PAYROLL_VIEW],
};

export function hasPermission(roles: string[], permission: string): boolean {
  return roles.some((role) => {
    const granted = ROLE_PERMISSIONS[role as SystemRole];
    if (!granted) return false;
    return granted.includes("*") || granted.includes(permission);
  });
}
