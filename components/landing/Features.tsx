import { Zap, ShieldCheck, PieChart, KeyRound } from "lucide-react";

const FEATURES = [
  {
    title: "Instant payments",
    description:
      "Send and receive crypto in seconds, with near-zero fees. Pay a person or a merchant from the same wallet.",
    icon: Zap,
  },
  {
    title: "Escrow protection",
    description:
      "Hold funds in a trustless escrow contract until both sides are satisfied, then release or refund.",
    icon: ShieldCheck,
  },
  {
    title: "Portfolio tracking",
    description:
      "See every balance and transaction in one place, updated live from the chain.",
    icon: PieChart,
  },
  {
    title: "Self-custodial",
    description:
      "Your keys, your funds. EngiPay never holds your assets and never asks for your seed phrase.",
    icon: KeyRound,
  },
];

export default function Features() {
  return (
    <section className="py-24" id="features">
      <div className="container">
        <div className="mx-auto mb-16 max-w-[600px] text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight lg:text-4xl">
            Built for everyday payments
          </h2>
          <p className="leading-relaxed text-muted-foreground">
            Everything you need to move and manage your money on-chain, in one interface.
          </p>
        </div>

        <div className="mx-auto grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ title, description, icon: Icon }) => (
            <div
              key={title}
              className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
            >
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
