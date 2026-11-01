export default function FeatureCard({ icon, title, text, index = 0 }) {
  return (
    <article className="main-feature" style={{ animationDelay: `${index * 100}ms` }}>
      <span className="main-feature-icon" aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      <a className="main-text-link" href="#playground">Give it a try <span aria-hidden="true">&rarr;</span></a>
    </article>
  );
}
