import { PlanButton } from "../../billing/Billing";
import Form from "../Form/Form";
import FeatureCard from "../FeatureCard/FeatureCard";
import { pricingPlans } from "../../billing/plans";
import "./Main.css";

const features = [
  { icon: "✎", title: "Catch the little ideas", text: "A sentence, a checklist, a sudden spark. Give every thought a place to land." },
  { icon: "▦", title: "Make room for clarity", text: "Bring project plans, study notes, and everyday thoughts together in one calm space." },
  { icon: "↗", title: "Turn thoughts into action", text: "Find your next step and move from a blank page to something worth building." },
];

const testimonials = [
  { initials: "MC", name: "Maya Chen", role: "Designer & idea collector", quote: "I used to lose little ideas in a dozen different places. Now they finally have a home." },
  { initials: "JL", name: "Jordan Lee", role: "Student & planner", quote: "It feels easier to start when everything is calm, clear, and right where I need it." },
  { initials: "AR", name: "Alex Rivera", role: "Independent creator", quote: "My notes are turning into real next steps. That small change makes a big difference." },
];

export default function Main() {
  return (
    <main className="main-content" id="home">
      <section className="main-hero" aria-labelledby="hero-title">
        <div className="main-hero-copy">
          <span className="main-eyebrow">YOUR NEXT GREAT IDEA STARTS HERE</span>
          <h1 id="hero-title">Less scattered.<br /><span>More inspired.</span></h1>
          <p>A little space for your biggest ideas. Capture what matters, bring your thoughts together, and make your next move with NoteFlowAi.</p>
          <div className="main-actions">
            <a className="main-button" href="#playground">Try a quick note <span aria-hidden="true">↗</span></a>
            <a className="main-text-link" href="#features">Explore the possibilities <span aria-hidden="true">→</span></a>
          </div>
          <span className="main-caption">Start with a thought. See where it takes you.</span>
        </div>
        <div className="main-preview" aria-label="Example project note">
          <div className="main-preview-bar"><span><i /> My workspace</span><span>•••</span></div>
          <div className="main-preview-body">
            <span className="main-tag">✦ A fresh perspective</span>
            <h2>Something good is taking shape.</h2>
            <p>My next creative project</p>
            <ul className="main-checklist">
              <li><span>✓</span> Collect a few sparks of inspiration</li>
              <li><span>✓</span> Connect the ideas that belong together</li>
              <li><span>○</span> Make a little progress every day</li>
            </ul>
            <div className="main-preview-tip">✧ Small ideas. Unexpected possibilities.</div>
          </div>
          <span className="main-floating-tag">✦ A clearer mind starts here</span>
        </div>
      </section>

      <section className="main-section" id="features" aria-labelledby="features-title">
        <span className="main-eyebrow">THINK FREELY. KEEP IT TOGETHER.</span>
        <h2 id="features-title">A home for everything on your mind.</h2>
        <div className="main-feature-grid">
          {features.map((feature, index) => (
            <FeatureCard key={feature.title} {...feature} index={index} />
          ))}
        </div>
      </section>

      <section className="main-section community-section" aria-labelledby="community-title">
        <div className="section-heading">
          <div>
            <span className="main-eyebrow">GOOD THOUGHTS GROW HERE</span>
            <h2 id="community-title">A little more clarity, every day.</h2>
          </div>
          <p>See how a calmer space can help turn scattered thoughts into meaningful progress.</p>
        </div>
        <div className="testimonial-grid">
          {testimonials.map((testimonial) => (
            <article className="testimonial-card" key={testimonial.name}>
              <span className="testimonial-quote" aria-hidden="true">“</span>
              <p>{testimonial.quote}</p>
              <div className="testimonial-person">
                <span className="testimonial-avatar" aria-hidden="true">{testimonial.initials}</span>
                <div><strong>{testimonial.name}</strong><span>{testimonial.role}</span></div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="main-section pricing-section" id="pricing" aria-labelledby="pricing-title">
        <div className="section-heading">
          <div>
            <span className="main-eyebrow">SIMPLE SPACE. SIMPLE PLANS.</span>
            <h2 id="pricing-title">Choose your space to think.</h2>
          </div>
          <p>Start small and find the plan that fits the way you capture ideas.</p>
        </div>
        <div className="pricing-grid">
          {pricingPlans.map((plan) => (
            <article className={`pricing-card${plan.featured ? " pricing-card-featured" : ""}`} key={plan.id}>
              {plan.featured && <span className="pricing-badge">Recommended</span>}
              <span className="pricing-plan">{plan.name}</span>
              <p className="pricing-description">{plan.description}</p>
              <p className="pricing-price">{plan.price}<span> / month</span></p>
              <ul>
                {plan.features.map((feature) => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}
              </ul>
              <PlanButton plan={plan.id} featured={plan.featured} />
            </article>
          ))}
        </div>
        <p className="pricing-note">Monthly plans in USD. Secure payments powered by Stripe. Cancel through your billing settings.</p>
      </section>

      <section className="main-section contact-section" id="contact" aria-labelledby="contact-title">
        <div className="contact-art" aria-hidden="true">
          <div className="contact-art-note contact-art-note-back">a thought<br />becomes a plan</div>
          <div className="contact-art-note contact-art-note-front"><span>✦</span><br />Make room<br />for what’s next.</div>
          <span className="contact-art-spark contact-art-spark-one">✧</span>
          <span className="contact-art-spark contact-art-spark-two">✦</span>
        </div>
        <div className="contact-copy">
          <span className="main-eyebrow">WE’RE HERE FOR YOUR NEXT IDEA</span>
          <h2 id="contact-title">Let’s make room for a conversation.</h2>
          <p>Have a question, a suggestion, or a thought you want to explore? Start with a note and tell us what’s on your mind.</p>
          <a className="main-button" href="#playground">Write us a note <span aria-hidden="true">↗</span></a>
        </div>
      </section>

      <section className="main-playground main-section" id="playground" aria-labelledby="note-title">
        <div>
          <span className="main-eyebrow">FROM THOUGHT TO FIRST DRAFT</span>
          <h2 id="note-title">What’s on your mind?</h2>
          <p>Try a small note right here. A project idea, tomorrow’s priorities, or something you don’t want to forget.</p>
          <p className="main-caption">This demo keeps your note only until you leave or refresh the page.</p>
        </div>
        <Form />
      </section>

    </main>
  );
}
