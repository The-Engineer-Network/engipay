"use client";
import { useState } from 'react';
import Navbar from '@/components/landing/Navbar';
import Hero from '@/components/landing/Hero';
import Features from '@/components/landing/Features';
import Workflow from '@/components/landing/Workflow';
import Stats from '@/components/landing/Stats';
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
