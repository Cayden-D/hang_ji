export const derivePurchaseStatus = (completed, total) => {
  if (total > 0 && completed === total) return 'purchased';
  if (completed > 0) return 'purchasing';
  return 'pending_purchase';
};

export const canViewOrder = (user, order) => {
  if (user.role === 'admin' || user.role === 'purchase') return true;
  if (user.role === 'logistics') return ['purchased', 'shipped'].includes(order.status);
  return order.owner_user_id === user.sub;
};
