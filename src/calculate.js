/**
 * NYC Equivalent Rent Calculator — core financial engine.
 *
 * Equivalent Net Rent derivation (closed-form):
 *   R is the constant monthly rent that leaves the renter equally wealthy after N months.
 *   R satisfies: R*(N + B*q) = baseCost + forgoneWealth + A*q
 *   where:
 *     baseCost = (initialOutlay + cumulativeNetMonthlyCosts) - netEquityAtSale
 *     forgoneWealth = (FV of initial outlay - initial outlay) * (1 - invCapGainsRate)
 *     A = Σ C_m * (1+r)^(N-1-m)   [FV of buyer net monthly costs]
 *     B = ((1+r)^N - 1) / r        [annuity FV factor]
 *     q = 1 - invCapGainsRate      (after-tax factor on investment gains)
 *     C_m = buyer's net monthly cost in month m (gross housing costs minus tax savings)
 *
 * Tax treatment:
 *   Standard deductions use filingStatusOwnership (during ownership years).
 *   Home sale exclusion uses filingStatusSale ($250K single / $500K MFJ).
 *   Federal: mortgage interest deductible on first $750K; SALT capped at $10K.
 *   NY State: full interest + full property tax deductible (no SALT cap).
 *   Deductions granted only to extent itemized total exceeds standard deduction.
 *   Home sale CG tax: federal marginal rate on gain above primary residence exclusion.
 *   Investment gains (opportunity cost & delta portfolio): user-specified invCapGainsRate.
 */

export const FEDERAL_STANDARD = { single: 14600, mfj: 29200 };
export const NY_STANDARD = { single: 8000, mfj: 16050 };

function calcMonthlyPayment(loan, annualRate, termYears) {
  if (annualRate === 0) return loan / (termYears * 12);
  const r = annualRate / 12;
  const n = termYears * 12;
  return (loan * r) / (1 - Math.pow(1 + r, -n));
}

function buildAmortization(inputs) {
  const {
    homePrice,
    downPaymentPct,
    interestRate,
    propertyTaxAnnual,
    homeInsuranceAnnual,
    hoaMonthly,
    pmiRate,
    buyerClosingCostsPct,
    sellerClosingCostsPct,
    federalRate,
    nyStateRate,
    filingStatusOwnership,
    filingStatusSale,
    invCapGainsRate,
    appreciationRate,
    investmentReturn,
    monthlyRent,
    housingInflation,
    yearlyMaintenance,
  } = inputs;

  const downPayment = homePrice * (downPaymentPct / 100);
  const loan = homePrice - downPayment;
  const buyerCC = homePrice * (buyerClosingCostsPct / 100);
  const initialOutlay = downPayment + buyerCC;

  const monthlyRate = interestRate / 100 / 12;
  const monthlyPayment = calcMonthlyPayment(loan, interestRate / 100, 30);
  const pmiThreshold = homePrice * 0.80;
  const r = investmentReturn / 100 / 12; // monthly investment return

  const fedStd = FEDERAL_STANDARD[filingStatusOwnership];
  const nyStd = NY_STANDARD[filingStatusOwnership];
  const exclusion = filingStatusSale === 'mfj' ? 500000 : 250000;
  const invCGRate = (invCapGainsRate || 0) / 100;
  const fedRate = federalRate / 100;
  const nyRate = nyStateRate / 100;
  const loanCapFactor = loan > 0 ? Math.min(1, 750000 / loan) : 1;

  // ── Phase 1: build month-by-month amortization ─────────────────────────
  const months = [];
  const yearlyTaxSavings = [];
  let loanBalance = loan;

  for (let y = 1; y <= 30; y++) {
    const inflFactor = Math.pow(1 + housingInflation / 100, y - 1);
    const annualPropTax = propertyTaxAnnual * inflFactor;
    const annualInsurance = homeInsuranceAnnual * inflFactor;
    const mHOA = hoaMonthly * inflFactor;
    const mMarketRent = monthlyRent * Math.pow(1 + housingInflation / 100, y - 1);

    let yearInterest = 0;

    for (let m = 0; m < 12; m++) {
      const interest = loanBalance * monthlyRate;
      const principal = Math.min(monthlyPayment - interest, loanBalance);
      loanBalance = Math.max(0, loanBalance - principal);

      const mPropTax = annualPropTax / 12;
      const mIns = annualInsurance / 12;
      const pmi = loanBalance > pmiThreshold ? (loanBalance * (pmiRate / 100)) / 12 : 0;
      yearInterest += interest;

      months.push({
        year: y,
        interest,
        propTax: mPropTax,
        insurance: mIns,
        hoa: mHOA,
        pmi,
        grossMonthlyCost: monthlyPayment + mPropTax + mIns + mHOA + pmi,
        loanBalance,
        marketRent: mMarketRent,
        taxSavings: 0,     // filled below after year total known
        netMonthlyCost: 0, // filled below
      });
    }

    // Annual tax savings: federal + NY, each vs their respective standard deduction
    const fedDeductInterest = yearInterest * loanCapFactor;
    const fedDeductPropTax = Math.min(annualPropTax, 10000);
    const fedItemized = fedDeductInterest + fedDeductPropTax;
    const fedBenefit = Math.max(0, fedItemized - fedStd) * fedRate;

    const nyItemized = yearInterest + annualPropTax;
    const nyBenefit = Math.max(0, nyItemized - nyStd) * nyRate;
    const annualTS = fedBenefit + nyBenefit;
    yearlyTaxSavings.push(annualTS);

    const base = (y - 1) * 12;
    for (let m = 0; m < 12; m++) {
      months[base + m].taxSavings = annualTS / 12;
      months[base + m].netMonthlyCost = months[base + m].grossMonthlyCost - annualTS / 12;
    }
  }

  // ── Phase 2: year-by-year equivalent rent ────────────────────────────────
  const yearData = [];
  let cumBuyerCosts = 0;
  // Running totals for averaging breakdown items over the holding period
  let cumPropTax = 0;
  let cumInsurance = 0;
  let cumHOA = 0;
  let cumPMI = 0;
  let cumAnnualTaxSavings = 0;
  let cumMarketRent = 0;

  const maint = (yearlyMaintenance || 0) / 12;

  // Cash flow delta portfolio: each month the renter invests (buyer monthly cost − market rent).
  // Buyer monthly cost = P&I + HOA + insurance + property tax + PMI + maintenance − tax savings.
  // Market rent grows at housingInflation each year.
  // Portfolio compounds at the investment return rate. At liquidation, cap gains tax applies to
  // gains only (final value − net principal, where principal = Σ deposits − Σ withdrawals).
  let deltaPV = 0;
  let deltaNetPrincipal = 0;

  for (let y = 1; y <= 30; y++) {
    const N = y * 12; // total months in holding period
    const base = (y - 1) * 12;
    const yearMonths = months.slice(base, base + 12);
    const annualTaxSavings = yearlyTaxSavings[y - 1];

    // Accumulate per-month values for this year (used for period averages and delta portfolio)
    for (const mo of yearMonths) {
      cumPropTax += mo.propTax;
      cumInsurance += mo.insurance;
      cumHOA += mo.hoa;
      cumPMI += mo.pmi;
      cumMarketRent += mo.marketRent;

      // Grow delta portfolio at monthly investment return, then add this month's net flow.
      // mo.netMonthlyCost = P&I + propTax + insurance + HOA + PMI − taxSavings (no maintenance).
      deltaPV *= (1 + r);
      const delta = mo.netMonthlyCost + maint - mo.marketRent;
      deltaPV += delta;
      deltaNetPrincipal += delta;
    }
    cumAnnualTaxSavings += annualTaxSavings;

    const yearGross = yearMonths.reduce((s, m) => s + m.grossMonthlyCost, 0);
    cumBuyerCosts += yearGross - annualTaxSavings;

    // Home value and sale metrics
    const homeValueY = homePrice * Math.pow(1 + appreciationRate / 100, y);
    const loanBalanceAtEnd = yearMonths[11].loanBalance;
    const grossSaleProceeds = homeValueY * (1 - sellerClosingCostsPct / 100);
    const capitalGain = homeValueY - homePrice;
    const taxableGain = Math.max(0, capitalGain - exclusion);
    const cgTax = taxableGain * fedRate; // federal marginal rate; exclusion applied above
    const netEquity = grossSaleProceeds - loanBalanceAtEnd - cgTax;

    // baseCost = total cost of buying (net of tax savings) minus equity realized
    const totalCostOfBuying = initialOutlay + cumBuyerCosts;
    const baseCost = totalCostOfBuying - netEquity;
    const baseCostAdj = baseCost + maint * N; // add maintenance paid over holding period

    // Opportunity cost of initial outlay: grow at investment return, after invCGRate on gains only
    const fvInitial = initialOutlay * Math.pow(1 + investmentReturn / 100, y);
    const forgoneWealth = (fvInitial - initialOutlay) * (1 - invCGRate);

    // After-tax liquidation value of the cash flow delta portfolio at year N.
    // Cap gains tax applies only to gains (portfolio value − net principal); no tax benefit on losses.
    const deltaGains = Math.max(0, deltaPV - deltaNetPrincipal);
    const deltaPortAfterTax = deltaPV - deltaGains * invCGRate;

    // Equivalent rent: constant monthly payment R such that the renter is equally wealthy as the buyer.
    //   Buyer's net cost          = baseCostAdj + forgoneWealth
    //   Renter's net cost at R/mo = R*N − forgoneWealth − deltaPortAfterTax
    //   Setting equal → R = (baseCostAdj + forgoneWealth + deltaPortAfterTax) / N
    // When deltaPortAfterTax > 0 (buyer paid more than rent → renter invested extra), R rises,
    // making buying look more expensive. When negative (buyer paid less), R falls.
    const R = (baseCostAdj + forgoneWealth + deltaPortAfterTax) / N;

    const oppCostMonthly = forgoneWealth / N;
    const equivalentNetRent = R;
    const marketRentAtY = monthlyRent * Math.pow(1 + housingInflation / 100, y - 1);

    yearData.push({
      year: y,
      homeValue: homeValueY,
      loanBalance: loanBalanceAtEnd,
      netEquity,
      grossSaleProceeds,
      cgTax,
      equivalentNetRent,
      marketRentAtY,
      totalCostOfBuying,
      cumBuyerCosts,
      baseCost,
      oppCostMonthly,
      deltaPortAfterTax,
      annualTaxSavings,
      avgMonthly: {
        pi: monthlyPayment,
        closingCostAmortized: buyerCC / N,
        // All of the following are averages over months 1..N, not point-in-time year-N values
        propTax: cumPropTax / N,
        insurance: cumInsurance / N,
        hoa: cumHOA / N,
        pmi: cumPMI / N,
        maintenanceAmortized: maint,
        taxSavings: cumAnnualTaxSavings / N, // avg monthly = cumulative annual / total months
        marketRent: cumMarketRent / N,
        oppCostMonthly,
        netEquityCredit: netEquity > 0 ? netEquity / N : 0,
      },
    });
  }

  // ── Phase 3: renter vs buyer wealth over 30 years ──────────────────────
  // Renter invests initialOutlay upfront; each month invests/withdraws (buyer_net_cost - market_rent)
  let renterPort = initialOutlay;
  let renterCostBasis = initialOutlay;
  const wealthData = [];

  for (let mi = 0; mi < 360; mi++) {
    const mo = months[mi];
    renterPort *= 1 + r;
    const contribution = mo.netMonthlyCost - mo.marketRent;
    renterPort += contribution;
    if (contribution > 0) renterCostBasis += contribution;

    if ((mi + 1) % 12 === 0) {
      const y = (mi + 1) / 12;
      const yd = yearData[y - 1];
      const renterGains = Math.max(0, renterPort - renterCostBasis);
      const renterAfterTax = renterPort - renterGains * invCGRate;
      wealthData.push({
        year: y,
        buyerWealth: yd.netEquity,
        renterWealth: Math.max(0, renterAfterTax), // floor at 0 — renter wouldn't continue if bankrupt
      });
    }
  }

  return { yearData, wealthData, monthlyPayment, loan, initialOutlay, downPayment, buyerCC };
}

export function runCalculation(inputs) {
  return buildAmortization(inputs);
}
