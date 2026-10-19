"use client";

import { useEffect, useState } from "react";
import Logo from "./Logo";

const LINKS = [
  { label: "Product", href: "#demo" },
  { label: "Features", href: "#why" },
  { label: "Learn", href: "/editor" },
  { label: "For Educators", href: "#learners" },
  { label: "Pricing", href: "#" },
  { label: "Community", href: "#testimonials" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 24);
      setHidden(y > last && y > 150); // hide going down, reveal going up
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={"site-nav" + (scrolled ? " scrolled" : "") + (hidden ? " hidden" : "")}>
      <div className="nav-inner">
        <a href="/" className="nav-brand">
          <Logo size={30} showWord />
        </a>

        <nav className="nav-links">
          {LINKS.map((link) => (
            <a key={link.label} href={link.href} className="nav-link">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="nav-right">
          <button className="nav-search" aria-label="Search" type="button">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" strokeLinecap="round" />
            </svg>
          </button>
          <a href="/editor" className="btn btn-ghost">
            Sign in
          </a>
          <a href="/editor" className="btn btn-solid">
            Get Started <span className="btn-arrow">→</span>
          </a>
        </div>
      </div>
    </header>
  );
}
