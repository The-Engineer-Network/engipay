import type { ReactNode } from "react"
import { Reveal } from "@/components/marketing/Reveal"

interface MarketingHeroProps {
  title: string
  /** The part of the title painted with the brand gradient. */
  highlight?: string
  description: string
  /** Small line under the description, e.g. a last-updated date. */
  meta?: ReactNode
}

/** The page opener shared by every marketing page, so they feel like one site. */
export function MarketingHero({ title, highlight, description, meta }: MarketingHeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-border py-24">
      <div className="aurora opacity-80" aria-hidden="true" />
      <div className="grid-fade" aria-hidden="true" />

      <div className="container relative text-center">
        <Reveal>
          <h1 className="mb-5 text-balance text-4xl font-bold tracking-tight lg:text-5xl">
            {title}
            {highlight && (
              <>
                {" "}
                <span className="text-gradient">{highlight}</span>
              </>
            )}
          </h1>
        </Reveal>

        <Reveal delay={90}>
          <p className="mx-auto max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {description}
          </p>
          {meta && <p className="mt-4 text-sm text-muted-foreground">{meta}</p>}
        </Reveal>
      </div>
    </section>
  )
}
