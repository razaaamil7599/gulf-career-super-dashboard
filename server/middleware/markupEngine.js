/**
 * Markup Engine Middleware
 * Adds Gulf Career Gateway's margin on top of agency service charge.
 * MARKUP_TYPE = "fixed"   → adds MARKUP_FIXED_AMOUNT (default 20000)
 * MARKUP_TYPE = "percent" → adds MARKUP_PERCENT % of service charge
 */

const MARKUP_TYPE = process.env.MARKUP_TYPE || 'fixed';
const MARKUP_FIXED = parseInt(process.env.MARKUP_FIXED_AMOUNT || '20000', 10);
const MARKUP_PERCENT = parseFloat(process.env.MARKUP_PERCENT || '15');

function markupEngine(req, res, next) {
  const { serviceCharge } = req.body;

  if (serviceCharge === undefined || serviceCharge === null || serviceCharge === '') {
    req.markup = {
      originalCharge: 0,
      ourMargin: 0,
      candidatePrice: 0,
      markupType: MARKUP_TYPE,
    };
    return next();
  }

  if (isNaN(serviceCharge)) {
    return res.status(400).json({ error: 'serviceCharge must be a number.' });
  }

  const charge = parseFloat(serviceCharge);
  let margin, candidatePrice;

  if (MARKUP_TYPE === 'percent') {
    margin = Math.round((charge * MARKUP_PERCENT) / 100);
  } else {
    margin = MARKUP_FIXED;
  }

  candidatePrice = charge + margin;

  // Attach to request for next handler
  req.markup = {
    originalCharge: charge,
    ourMargin: margin,
    candidatePrice,
    markupType: MARKUP_TYPE,
  };

  next();
}

module.exports = markupEngine;
