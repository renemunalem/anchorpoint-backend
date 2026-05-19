export const rbacPermissions = [
  {
    id: "rbac-Admin",
    role: "Admin",
    permissions: {
      canAccessAdmin: true,
      canManageMembers: true,
      canManageVendors: true,
      canManagePolicies: true,
      canManageClaims: true,
      canViewReports: true,
      canManageUsers: true,
    },
  },
  {
    id: "rbac-Agent",
    role: "Agent",
    permissions: {
      canAccessAdmin: false,
      canManageMembers: true,
      canManageVendors: true,
      canManagePolicies: true,
      canManageClaims: true,
      canViewReports: true,
      canManageUsers: false,
    },
  },
  {
    id: "rbac-Member",
    role: "Member",
    permissions: {
      canAccessAdmin: false,
      canManageMembers: false,
      canManageVendors: false,
      canManagePolicies: false,
      canManageClaims: false,
      canViewReports: false,
      canManageUsers: false,
    },
  },
  {
    id: "rbac-Vendor",
    role: "Vendor",
    permissions: {
      canAccessAdmin: false,
      canManageMembers: false,
      canManageVendors: false,
      canManagePolicies: false,
      canManageClaims: false,
      canViewReports: false,
      canManageUsers: false,
    },
  },
] as const;
