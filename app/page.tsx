"use client";
import { useState } from 'react';
import Navbar from '@/components/landing/Navbar';
import Hero from '@/components/landing/Hero';
import Features from '@/components/landing/Features';
import Workflow from '@/components/landing/Workflow';
import CTA from '@/components/landing/CTA';
import Footer from '@/components/landing/Footer';
import AuthModal from '@/components/landing/LandingAuthModal';

export default function LandingPage() {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const openAuthModal = () => setIsAuthModalOpen(true);
  const closeAuthModal = () => setIsAuthModalOpen(false);

  return (
    <main>
      <Navbar onGetStarted={openAuthModal} />
      <div className="cosmic-bg">
        <Hero onGetStarted={openAuthModal} />
      </div>
      <Features />
      <Workflow />
      <CTA onGetStarted={openAuthModal} />
      <Footer />

      <AuthModal isOpen={isAuthModalOpen} onClose={closeAuthModal} />
    </main>
  );
}
