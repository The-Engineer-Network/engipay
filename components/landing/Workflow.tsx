const STEPS = [
  { title: "Connect wallet", desc: "Link your wallet securely in seconds." },
  { title: "Fund account", desc: "Move crypto in from any wallet or exchange." },
  { title: "Send & pay", desc: "Pay anyone, anywhere, wallet-to-wallet." },
  { title: "Track", desc: "Watch balances and history update live." },
];

export default function Workflow() {
  return (
    <section className="border-y border-border bg-card/40 py-24 text-center" id="how-it-works">
      <div className="container">
        <h2 className="mb-4 text-3xl font-bold tracking-tight lg:text-4xl">
          One app. Four steps.
        </h2>
        {/* was `text-muted`, a background token, so this line was unreadable */}
        <p className="mb-16 text-muted-foreground">
          Get started in minutes.
        </p>

        <ol className="relative mx-auto flex max-w-[900px] flex-col items-center justify-between gap-10 md:flex-row md:items-start md:gap-0 md:before:absolute md:before:left-[80px] md:before:right-[80px] md:before:top-[30px] md:before:h-px md:before:bg-border md:before:content-['']">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="relative z-10 flex w-full max-w-[200px] flex-col items-center"
            >
              <div className="mb-5 flex h-[60px] w-[60px] items-center justify-center rounded-full border-2 border-primary bg-background text-2xl font-bold text-primary">
                {index + 1}
              </div>
              <h3 className="mb-2 text-base font-semibold">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
