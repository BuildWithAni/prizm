import Navbar from "../components/landing/Navbar";
import ScrollProgress from "../components/landing/ScrollProgress";
import Hero from "../components/landing/Hero";
import FeatureStrip from "../components/landing/FeatureStrip";
import DemoSection from "../components/landing/DemoSection";
import WhySection from "../components/landing/WhySection";
import AudienceSection from "../components/landing/AudienceSection";
import StatsBar from "../components/landing/StatsBar";
import Testimonials from "../components/landing/Testimonials";
import CtaSection from "../components/landing/CtaSection";
import Footer from "../components/landing/Footer";

export default function LandingPage() {
  return (
    <div className="landing">
      <ScrollProgress />
      <Navbar />
      <main>
        <Hero />
        <FeatureStrip />
        <DemoSection />
        <WhySection />
        <AudienceSection />
        <StatsBar />
        <Testimonials />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
}
