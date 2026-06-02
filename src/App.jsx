import { useState, useMemo, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ReferenceLine, ResponsiveContainer, ReferenceDot, Label,
} from 'recharts'
import { runCalculation } from './calculate'

// ─── defaults ────────────────────────────────────────────────────────────────
const DEFAULTS = {
  homePrice: 1485000,
  downPaymentPct: 25,
  interestRate: 5.25,
  propertyTaxAnnual: 12000,
  homeInsuranceAnnual: 1740,
  hoaMonthly: 573,
  pmiRate: 0,
  yearlyMaintenance: 0,
  buyerClosingCostsPct: 3.4,
  sellerClosingCostsPct: 8,
  federalRate: 35,
  nyStateRate: 10,
  filingStatusOwnership: 'single',
  filingStatusSale: 'mfj',
  invCapGainsRate: 34.3,
  appreciationRate: 3,
  investmentReturn: 8,
  monthlyRent: 6000,
  housingInflation: 3,
}

// ─── helpers ─────────────────────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const fmtK = (n) => `$${(n / 1000).toFixed(0)}k`

function numInput(label, key, inputs, setInputs, opts = {}) {
  const { prefix = '', suffix = '', step = 1, min = 0, max } = opts
  return (
    <div className="input-row">
      <label>{label}</label>
      <div className="input-wrap">
        {prefix && <span className="affix">{prefix}</span>}
        <input
          type="number"
          step={step}
          min={min}
          max={max}
          value={inputs[key]}
          onChange={e => setInputs(p => ({ ...p, [key]: parseFloat(e.target.value) || 0 }))}
        />
        {suffix && <span className="affix">{suffix}</span>}
      </div>
    </div>
  )
}

// ─── custom tooltip ───────────────────────────────────────────────────────────
function RentTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="tooltip-box">
      <p className="tt-label">Year {label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {fmt(p.value)}
        </p>
      ))}
    </div>
  )
}

function WealthTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="tooltip-box">
      <p className="tt-label">Year {label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {fmt(p.value)}
        </p>
      ))}
    </div>
  )
}

// ─── main app ─────────────────────────────────────────────────────────────────
export default function App() {
  const [inputs, setInputs] = useState(DEFAULTS)
  const [selectedYear, setSelectedYear] = useState(10)

  const results = useMemo(() => {
    try { return runCalculation(inputs) }
    catch (e) { console.error('Calculation error:', e); return null }
  }, [inputs])

  const chartData = useMemo(() => {
    if (!results) return []
    return results.yearData.map(d => ({
      year: d.year,
      equivalentNetRent: Math.round(d.equivalentNetRent),
      marketRent: Math.round(d.marketRentAtY),
    }))
  }, [results])

  const wealthChartData = useMemo(() => {
    if (!results) return []
    return results.wealthData.map(d => ({
      year: d.year,
      'Buyer Net Wealth': Math.round(d.buyerWealth),
      'Renter Net Wealth': Math.round(d.renterWealth),
    }))
  }, [results])

  // Find break-even year
  const breakEvenYear = useMemo(() => {
    if (!chartData.length) return null
    for (let i = 1; i < chartData.length; i++) {
      const prev = chartData[i - 1]
      const curr = chartData[i]
      if (prev.equivalentNetRent > prev.marketRent && curr.equivalentNetRent <= curr.marketRent) {
        return curr.year
      }
    }
    return null
  }, [chartData])

  const selectedData = results?.yearData[selectedYear - 1]
  const bd = selectedData?.avgMonthly

  return (
    <div className="app">
      <header className="app-header">
        <h1>NYC Rent vs. Buy Calculator</h1>
        <p className="subtitle">Find your break-even holding period and equivalent monthly cost of ownership</p>
      </header>

      <div className="layout">
        {/* ── INPUTS ── */}
        <aside className="inputs-panel">
          {/* Purchase */}
          <section className="input-section">
            <h3>Purchase</h3>
            {numInput('Home Price', 'homePrice', inputs, setInputs, { prefix: '$', step: 10000 })}
            {numInput('Down Payment', 'downPaymentPct', inputs, setInputs, { suffix: '%', step: 0.5, min: 0, max: 100 })}
            {numInput('Interest Rate', 'interestRate', inputs, setInputs, { suffix: '%', step: 0.125 })}
            {numInput('Property Tax', 'propertyTaxAnnual', inputs, setInputs, { prefix: '$', suffix: '/yr', step: 500 })}
            {numInput('Home Insurance', 'homeInsuranceAnnual', inputs, setInputs, { prefix: '$', suffix: '/yr', step: 250 })}
            {numInput('HOA', 'hoaMonthly', inputs, setInputs, { prefix: '$', suffix: '/mo', step: 100 })}
            {numInput('PMI Rate', 'pmiRate', inputs, setInputs, { suffix: '%/yr', step: 0.05, min: 0 })}
            {numInput('Maintenance', 'yearlyMaintenance', inputs, setInputs, { prefix: '$', suffix: '/yr', step: 1000 })}
            {numInput('Buyer Closing Costs', 'buyerClosingCostsPct', inputs, setInputs, { suffix: '% of price', step: 0.25 })}
            {numInput('Seller Closing Costs', 'sellerClosingCostsPct', inputs, setInputs, { suffix: '% of sale', step: 0.25 })}
          </section>

          {/* Tax */}
          <section className="input-section">
            <h3>Taxes</h3>
            {numInput('Federal Marginal Rate', 'federalRate', inputs, setInputs, { suffix: '%', step: 1, max: 60 })}
            {numInput('NY State Marginal Rate', 'nyStateRate', inputs, setInputs, { suffix: '%', step: 0.5, max: 20 })}
            <div className="input-row">
              <label>Status (ownership)</label>
              <select
                value={inputs.filingStatusOwnership}
                onChange={e => setInputs(p => ({ ...p, filingStatusOwnership: e.target.value }))}
              >
                <option value="single">Single</option>
                <option value="mfj">Married / MFJ</option>
              </select>
            </div>
            <div className="input-row">
              <label>Status (at sale)</label>
              <select
                value={inputs.filingStatusSale}
                onChange={e => setInputs(p => ({ ...p, filingStatusSale: e.target.value }))}
              >
                <option value="single">Single ($250K excl.)</option>
                <option value="mfj">Married ($500K excl.)</option>
              </select>
            </div>
            {numInput('Inv. Capital Gains Rate', 'invCapGainsRate', inputs, setInputs, { suffix: '%', step: 1, min: 0, max: 50 })}
          </section>

          {/* Scenario */}
          <section className="input-section">
            <h3>Scenario</h3>
            {numInput('Home Appreciation', 'appreciationRate', inputs, setInputs, { suffix: '%/yr', step: 0.25 })}
            {numInput('Investment Return', 'investmentReturn', inputs, setInputs, { suffix: '%/yr', step: 0.25 })}
            {numInput('Market Rent', 'monthlyRent', inputs, setInputs, { prefix: '$', suffix: '/mo', step: 100 })}
            {numInput('Housing Cost Inflation', 'housingInflation', inputs, setInputs, { suffix: '%/yr', step: 0.25 })}
          </section>

          {/* Summary stats */}
          {results && (
            <section className="input-section summary-stats">
              <h3>Loan Summary</h3>
              <div className="stat-row"><span>Loan Amount</span><strong>{fmt(results.loan)}</strong></div>
              <div className="stat-row"><span>Monthly P&I</span><strong>{fmt(results.monthlyPayment)}</strong></div>
              <div className="stat-row"><span>Total Upfront</span><strong>{fmt(results.initialOutlay)}</strong></div>
              <div className="stat-row"><span>Down Payment</span><strong>{fmt(results.downPayment)}</strong></div>
              <div className="stat-row"><span>Closing Costs</span><strong>{fmt(results.buyerCC)}</strong></div>
            </section>
          )}
        </aside>

        {/* ── RESULTS ── */}
        <main className="results-panel">
          {results && (
            <>
              {/* ── Primary chart ── */}
              <section className="chart-card">
                <h2>Equivalent Net Rent vs. Market Rent</h2>
                <p className="chart-sub">
                  {breakEvenYear
                    ? <>Break-even at <strong>Year {breakEvenYear}</strong> — owning becomes cheaper than renting after this point.</>
                    : <strong>Break-even beyond 30 years — renting is cheaper over the entire 30-year horizon.</strong>}
                </p>
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="year" label={{ value: 'Holding Period (years)', position: 'insideBottom', offset: -4 }} />
                    <YAxis tickFormatter={fmtK} label={{ value: 'Monthly ($)', angle: -90, position: 'insideLeft', offset: 10 }} />
                    <Tooltip content={<RentTooltip />} />
                    <Legend verticalAlign="top" />
                    <Line
                      type="monotone"
                      dataKey="equivalentNetRent"
                      name="Equivalent Net Rent"
                      stroke="#2563eb"
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="marketRent"
                      name="Market Rent (inflating)"
                      stroke="#16a34a"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      dot={false}
                    />
                    {breakEvenYear && (
                      <ReferenceLine x={breakEvenYear} stroke="#f59e0b" strokeDasharray="4 2" strokeWidth={1.5}>
                        <Label value={`Break-even Yr ${breakEvenYear}`} position="top" fill="#b45309" fontSize={12} />
                      </ReferenceLine>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </section>

              {/* ── Slider + headline ── */}
              <section className="headline-card">
                <div className="slider-label">
                  <span>Holding period:</span>
                  <strong>Year {selectedYear}</strong>
                </div>
                <input
                  type="range" min={1} max={30} value={selectedYear}
                  onChange={e => setSelectedYear(Number(e.target.value))}
                  className="year-slider"
                />
                <div className="headline-number">
                  Equivalent Monthly Cost if you sell in Year {selectedYear}:{' '}
                  <span className="big-number">{fmt(selectedData?.equivalentNetRent)}</span>
                </div>
                <div className="headline-sub">
                  Market rent in Year {selectedYear}: {fmt(selectedData?.marketRentAtY)} &nbsp;|&nbsp;
                  Home value: {fmt(selectedData?.homeValue)} &nbsp;|&nbsp;
                  Net equity at sale: {fmt(selectedData?.netEquity)}
                </div>
              </section>

              {/* ── Breakdown table ── */}
              {selectedData && bd && (
                <section className="breakdown-card">
                  <h2>Monthly Cost Breakdown — Year {selectedYear}</h2>
                  <p className="chart-sub">All figures are monthly averages for year {selectedYear} (housing costs inflated {inputs.housingInflation}%/yr).</p>
                  <table className="breakdown-table">
                    <thead>
                      <tr><th>Component</th><th>Monthly</th><th>Notes</th></tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Principal & Interest</td>
                        <td className="num">{fmt(bd.pi)}</td>
                        <td>Fixed 30-yr payment</td>
                      </tr>
                      <tr>
                        <td>Closing Costs (amortized)</td>
                        <td className="num">{fmt(bd.closingCostAmortized)}</td>
                        <td>{fmt(results.buyerCC)} ÷ {selectedYear * 12} months</td>
                      </tr>
                      <tr>
                        <td>Property Tax</td>
                        <td className="num">{fmt(bd.propTax)}</td>
                        <td>Avg monthly, yr 1–{selectedYear} ({inputs.housingInflation}%/yr growth)</td>
                      </tr>
                      <tr>
                        <td>Home Insurance</td>
                        <td className="num">{fmt(bd.insurance)}</td>
                        <td>Avg monthly, yr 1–{selectedYear}</td>
                      </tr>
                      <tr>
                        <td>HOA</td>
                        <td className="num">{fmt(bd.hoa)}</td>
                        <td>Avg monthly, yr 1–{selectedYear}</td>
                      </tr>
                      <tr>
                        <td>PMI</td>
                        <td className="num">{fmt(bd.pmi)}</td>
                        <td>Avg monthly, yr 1–{selectedYear} (until LTV ≤ 80%)</td>
                      </tr>
                      <tr>
                        <td>Maintenance (amortized)</td>
                        <td className="num">{fmt(bd.maintenanceAmortized)}</td>
                        <td>{fmt(inputs.yearlyMaintenance)}/yr ÷ 12 months</td>
                      </tr>
                      <tr className="deduction-row">
                        <td>Tax Savings</td>
                        <td className="num">−{fmt(bd.taxSavings)}</td>
                        <td>Avg monthly, yr 1–{selectedYear} (federal + NY itemized)</td>
                      </tr>
                      <tr className="deduction-row">
                        <td>Net Equity Credit</td>
                        <td className="num">−{fmt(selectedData.netEquity > 0 ? bd.netEquityCredit : 0)}</td>
                        <td>Net sale proceeds ÷ {selectedYear * 12} months owned</td>
                      </tr>
                      <tr className="opp-row">
                        <td>Opportunity Cost</td>
                        <td className="num">+{fmt(bd.oppCostMonthly)}</td>
                        <td>Forgone return on {fmt(results.initialOutlay)} over {selectedYear} yr</td>
                      </tr>
                      <tr className="total-row">
                        <td>Equivalent Net Rent</td>
                        <td className="num">{fmt(selectedData.equivalentNetRent)}</td>
                        <td>What you'd pay to match owner's net wealth</td>
                      </tr>
                      <tr className="ref-row">
                        <td>Avg Market Rent</td>
                        <td className="num">{fmt(bd.marketRent)}</td>
                        <td>Avg monthly rent paid if renting, yr 1–{selectedYear}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="breakdown-footer">
                    <div className="bf-item">
                      <span>Annual Tax Savings (Yr {selectedYear})</span>
                      <strong>{fmt(selectedData.annualTaxSavings)}</strong>
                    </div>
                    <div className="bf-item">
                      <span>Capital Gains Tax at Sale</span>
                      <strong>{fmt(selectedData.cgTax)}</strong>
                    </div>
                    <div className="bf-item">
                      <span>Loan Balance at Sale</span>
                      <strong>{fmt(selectedData.loanBalance)}</strong>
                    </div>
                  </div>
                </section>
              )}

              {/* ── Wealth comparison chart ── */}
              <section className="chart-card">
                <h2>Net Wealth Over 30 Years</h2>
                <p className="chart-sub">
                  Buyer wealth = net equity after selling costs & capital gains tax.
                  Renter wealth = {fmt(results.initialOutlay)} invested + monthly cost differences invested at {inputs.investmentReturn}%/yr (after LTCG tax).
                </p>
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={wealthChartData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="year" label={{ value: 'Year', position: 'insideBottom', offset: -4 }} />
                    <YAxis tickFormatter={fmtK} label={{ value: 'Net Wealth ($)', angle: -90, position: 'insideLeft', offset: 10 }} />
                    <Tooltip content={<WealthTooltip />} />
                    <Legend verticalAlign="top" />
                    <Line
                      type="monotone"
                      dataKey="Buyer Net Wealth"
                      stroke="#2563eb"
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="Renter Net Wealth"
                      stroke="#16a34a"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </section>
            </>
          )}
        </main>
      </div>

      <footer className="app-footer">
        <p>
          Estimates only — not financial advice. Standard deductions use filing status (during ownership): federal $14,600 single / $29,200 MFJ; NY $8,000 / $16,050.
          Home sale CG tax uses federal marginal rate on appreciation above the primary residence exclusion ($250K single / $500K MFJ per filing status at sale).
          Investment portfolio gains (opportunity cost &amp; cash-flow delta) taxed at the Inv. Capital Gains Rate input.
          Mortgage interest deductibility capped at $750K loan. SALT deduction capped at $10K federal.
        </p>
      </footer>
    </div>
  )
}
