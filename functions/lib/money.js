// functions/lib/money.js
//
// Money sums used in more than one place, so the refund screen, the closed
// consultation record and the patient's email always agree to the pesewa.
// Amounts are GHS with two decimals. Tested in functions/test/.

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * A patient no-show who asks for a refund: the hospital keeps
 * `forfeitPercent` of what was paid (the no-show policy at the time), the
 * rest goes back. Resolves { kept, refund } (refund = paid - kept, so the
 * two always add up to what was paid).
 */
function noShowSplit(amountPaid, forfeitPercent) {
  const paid = Math.max(0, Number(amountPaid) || 0);
  const percent = Math.min(100, Math.max(0, Number(forfeitPercent) || 0));
  const kept = round2((paid * percent) / 100);
  return { kept, refund: round2(paid - kept) };
}

module.exports = { round2, noShowSplit };
