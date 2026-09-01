const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const calculateOrderPerformance = ({
  totalAmount,
  purchaseTotal,
  freight,
  receivedUsd,
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
  // 财务入账：填写了实收美金则按“实收美金 × 汇率”入账；未填写则按总货值折算入账。
  const revenueCny = receivedUsd == null
    ? convertedOrderAmountCny
    : (rate > 0 ? roundMoney(Number(receivedUsd) * rate) : null);
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

