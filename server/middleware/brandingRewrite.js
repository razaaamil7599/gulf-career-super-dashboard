/**
 * Branding Rewrite Middleware
 * Strips agency contact info & logo, injects Gulf Career Gateway branding.
 */

const GULF_BRANDING = {
  companyName: 'Gulf Career Gateway',
  tagline: 'Your Trusted Gulf Employment Partner',
  contactPhone: '+92-300-GULF-CAR',   // Update with real number
  contactEmail: 'info@gulfcareergateway.com',
  website: 'https://www.gulfcareergateway.com',
  logoUrl: '/logo-gulf-career-gateway.png',
};

function brandingRewrite(req, res, next) {
  const body = req.body;

  // Strip agency identifiers
  delete body.agencyName;
  delete body.agencyLogo;
  delete body.agencyPhone;
  delete body.agencyEmail;
  delete body.agencyWebsite;
  delete body.agencyContact;

  // Inject Gulf Career Gateway branding
  req.brandedVacancy = {
    ...body,
    ...GULF_BRANDING,
    brandedAt: new Date().toISOString(),
  };

  next();
}

module.exports = brandingRewrite;
module.exports.GULF_BRANDING = GULF_BRANDING;
