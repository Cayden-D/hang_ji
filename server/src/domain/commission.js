const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const calculateOrderPerformance = ({
  totalAmount,
  purchaseTotal,
  freight,
  receivedCny,
  exchangeRate,
  commissionRatePercent
}) => {
  const orderAmount = Number(totalAmount || 0);
  const productCost = Number(purchaseTotal || 0);
  const shippingCost = Number(freight || 0);
  const rate = Number(exchangeRate || 0);
  const percentage = Number(commissionRatePercent || 0);
  const profitOriginal = roundMoney(orderAmount - productCost - shippingCost);
  const convertedOrderAmountCny = rate > 0 ? roundMoney(orderAmount * rate) : null;
  const revenueCny = receivedCny == null ? convertedOrderAmountCny : roundMoney(receivedCny);
  const productCostCny = rate > 0 ? roundMoney(productCost * rate) : null;
  const freightCny = rate > 0 ? roundMoney(shippingCost * rate) : null;
  const profitCny = revenueCny == null || productCostCny == null || freightCny == null
    ? null
    : roundMoney(revenueCny - productCostCny - freightCny);
  const commissionCny = profitCny == null ? null : roundMoney(profitCny * percentage / 100);
  return {
    profitOriginal,
    convertedOrderAmountCny,
    revenueCny,
    productCostCny,
    freightCny,
    profitCny,
    commissionCny
  };
};

