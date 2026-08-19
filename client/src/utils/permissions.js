// Client-side mirror of server/utils/permissions.js. Used to hide routes,
// links and buttons; the server always re-enforces the actual rules.

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
  cashier: ['pos.sell', 'invoice.view', 'returns.create', 'cash.open', 'cash.close'],
};

export function can(user, perm) {
  if (!user) return false;
  const perms = ROLE_PERMISSIONS[user.role] || [];
  return perms.includes('*') || perms.includes(perm);
}

export const PERM = {
  DASHBOARD: 'dashboard.view',
  POS: 'pos.sell',
  INVOICE_VIEW: 'invoice.view',
  INVOICE_VOID: 'invoice.void',
  INVOICE_EDIT: 'invoice.edit',
  RETURNS_CREATE: 'returns.create',
  REFUND_APPROVE: 'refund.approve',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_EDIT: 'inventory.edit',
  PURCHASES_CREATE: 'purchases.create',
  STOCK_ADJUST: 'stock.adjust',
  TRANSFERS_CREATE: 'transfers.create',
  EXPENSES_CREATE: 'expenses.create',
  EXPENSES_DELETE: 'expenses.delete',
  REPORTS_VIEW: 'reports.view',
  ACTIVITY_VIEW: 'activity.view',
  CASH_OPEN: 'cash.open',
  CASH_CLOSE: 'cash.close',
  CASH_VIEW: 'cash.view',
  BACKUP_DOWNLOAD: 'backup.download',
};