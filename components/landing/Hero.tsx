import Image from "next/image";

interface HeroProps {
  onGetStarted?: () => void;
}

export default function Hero({ onGetStarted }: HeroProps) {
  return (
    <section className="relative overflow-hidden pt-36 pb-20">
      <div className="container flex flex-col items-center gap-12 lg:flex-row">
        <div className="flex-1 text-center lg:text-left">
          <h1 className="mb-6 bg-gradient-to-r from-foreground to-primary bg-clip-text text-4xl font-bold leading-[1.1] text-transparent lg:text-6xl">
            Payments meet
            <br />
            DeFi. Seamlessly.
          </h1>

          {/* was `text-muted`, a background token — it rendered near-invisible */}
          <p className="mx-auto mb-10 max-w-[500px] text-base leading-relaxed text-muted-foreground lg:mx-0 lg:text-lg">
            Send crypto, pay merchants, and track your portfolio in one
            wallet-native app. Secure, self-custodial, and simple.
          </p>

          <div className="flex flex-col justify-center gap-4 sm:flex-row lg:justify-start">
            <button
              onClick={onGetStarted}
              className="glow-button mx-auto w-full max-w-[280px] rounded-full bg-primary px-8 py-3.5 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:mx-0 sm:w-auto"
            >
              Get started
            </button>
          </div>
        </div>

        <div className="relative mt-10 flex w-full flex-1 items-center justify-center lg:mt-0 lg:w-auto">
          <div
            className="absolute inset-0 z-0 rounded-full bg-primary/20 opacity-30 blur-[100px]"
            aria-hidden="true"
          />
          <div className="relative z-10 aspect-[3/4] w-full max-w-[400px] animate-fade-in lg:h-[700px] lg:max-w-[500px]">
            <Image
              src="/phone.png"
              alt="The EngiPay app on a phone"
              fill
              className="object-contain"
              priority
            />
          </div>
        </div>
      </div>
    </section>
  );
}
