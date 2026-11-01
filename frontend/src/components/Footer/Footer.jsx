import "./Footer.css";

export default function Footer() {
  return (
    <div className="site-footer-shell">
      <footer className="site-footer page-container">
        <div><a className="footer-brand" href="#home">NoteFlowAi</a><p>A little space for your biggest ideas.</p></div>
        <nav aria-label="Footer navigation">
          <a href="#home">Home</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#contact">Contact</a>
          <a href="#playground">Try a note</a>
        </nav>
        <div className="footer-bottom"><span>&copy; {new Date().getFullYear()} NoteFlowAi</span><a href="#home">Back to top &uarr;</a></div>
      </footer>
    </div>
  );
}
