import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground">
        The page you are looking for does not exist or has moved.
      </p>
      <div className="flex flex-wrap justify-center gap-3 pt-2">
        <Button asChild className="rounded-full">
          <Link href="/">Go to home</Link>
        </Button>
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
    </main>
  )
}
