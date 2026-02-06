"use client";
import { useState } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Features from './components/Features';
import Workflow from './components/Workflow';
import Stats from './components/Stats';
import CTA from './components/CTA';
import Footer from './components/Footer';
import AuthModal from './components/LandingAuthModal';

export default function LandingPage() {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const openAuthModal = () => setIsAuthModalOpen(true);
  const closeAuthModal = () => setIsAuthModalOpen(false);

  return (
    <main>
      <Navbar onGetStarted={openAuthModal} />
      <div className="bg-[radial-gradient(circle_at_50%_0%,rgba(0,242,138,0.15),transparent_60%)]">
        <Hero onGetStarted={openAuthModal} />
      </div>
      <Features />
      <Workflow />
      <Stats />
      <CTA onGetStarted={openAuthModal} />
      <Footer />

      <AuthModal isOpen={isAuthModalOpen} onClose={closeAuthModal} />
    </main>
  );
}

