// Granular role-based permissions.
// Roles: admin (everything), manager (operations, no user/store/settings
// administration), inventory (catalog + stock + purchases), cashier (sell +
// invoice view + returns requests + own cash drawer).
//
// The '*' permission grants everything.

const ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: [
    'dashboard.view',
    'pos.sell',
    'invoice.view',
    'invoice.void',
    'invoice.edit',
    'returns.create',
    'refund.approve',
    'inventory.view',
    'inventory.edit',
    'purchases.create',
    'stock.adjust',
    'transfers.create',
    'expenses.create',
    'expenses.delete',
    'reports.view',
    'activity.view',
    'cash.open',
    'cash.close',
    'cash.view',
    'backup.download',
  ],
  inventory: [
    'dashboard.view',
    'pos.sell',
    'invoice.view',
    'returns.create',
    'inventory.view',
    'inventory.edit',
    'purchases.create',
    'stock.adjust',
    'transfers.create',
    'expenses.create',
    'cash.open',
    'cash.view',
  ],
  cashier: [
    'pos.sell',
    'invoice.view',
    'returns.create',
    'cash.open',
    'cash.close',
  ],
};

const ALL_ROLES = Object.keys(ROLE_PERMISSIONS);

function can(role, perm) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(perm);
}

module.exports = { ROLE_PERMISSIONS, ALL_ROLES, can };