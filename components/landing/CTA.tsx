interface CTAProps {
  onGetStarted?: () => void;
}

export default function CTA({ onGetStarted }: CTAProps) {
  return (
    <section className="border-t border-border bg-card/40 py-24">
      <div className="container text-center">
        <h2 className="mb-6 text-3xl font-bold tracking-tight lg:text-5xl">
          Ready to try
          <br />
          on-chain payments?
        </h2>
        <p className="mb-10 text-lg text-muted-foreground">
          Connect a wallet and send your first payment in under a minute.
        </p>
        <button
          onClick={onGetStarted}
          className="glow-button mx-auto w-full max-w-[280px] rounded-full bg-primary px-8 py-3.5 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
        >
          Get started
        </button>
      </div>
    </section>
  );
}
