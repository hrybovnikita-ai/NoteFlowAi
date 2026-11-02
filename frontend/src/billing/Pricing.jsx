import { Link } from "react-router-dom";
import { PlanButton } from "./Billing";
import { pricingPlans } from "./plans";
import "./Pricing.css";

function PlanCards() {
  return (
    <div className="pricing-grid">
      {pricingPlans.map(plan => (
        <article className={`pricing-card${plan.featured ? " pricing-card-featured" : ""}`} key={plan.id}>
          {plan.featured && <span className="pricing-badge">Recommended</span>}
          <span className="pricing-plan">{plan.name}</span>
          <p className="pricing-description">{plan.description}</p>
          <p className="pricing-price">{plan.price}<span> / month</span></p>
          <ul>{plan.features.map(feature => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}</ul>
          <PlanButton plan={plan.id} featured={plan.featured} />
        </article>
      ))}
    </div>
  );
}

export default function PricingPage({ embedded = false }) {
  if (embedded) {
    return (
      <section className="dashboard-page pricing-page dashboard-pricing-page">
        <header className="dashboard-page-heading">
          <div>
            <span className="dashboard-eyebrow">SIMPLE SPACE. SIMPLE PLANS.</span>
            <h1>Choose your space to think.</h1>
            <p>Monthly plans in USD. Choose a plan to continue securely through Stripe.</p>
          </div>
        </header>
        <PlanCards />
        <p className="pricing-note">Your plan is checked by the server. Payment details are entered only in Stripe’s secure checkout.</p>
      </section>
    );
  }

  return (
    <main className="billing-shell pricing-page">
      <Link className="billing-brand" to="/"><img src="/favicon.png" alt="" />NoteFlow <span>AI</span></Link>
      <header className="billing-heading">
        <span className="main-eyebrow">SIMPLE SPACE. SIMPLE PLANS.</span>
        <h1>Choose your space to think.</h1>
        <p>Monthly plans in USD. Choose a plan to continue securely through Stripe.</p>
      </header>
      <PlanCards />
      <p className="pricing-note">Your plan is checked by the server. Payment details are entered only in Stripe’s secure checkout.</p>
    </main>
  );
}
