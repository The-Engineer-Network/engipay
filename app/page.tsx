"use client";
import { useState } from 'react';
import Navbar from '@/src/app/components/Navbar';
import Hero from '@/src/app/components/Hero';
import Features from '@/src/app/components/Features';
import Workflow from '@/src/app/components/Workflow';
import Stats from '@/src/app/components/Stats';
import CTA from '@/src/app/components/CTA';
import Footer from '@/src/app/components/Footer';
import AuthModal from '@/src/app/components/LandingAuthModal';

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
