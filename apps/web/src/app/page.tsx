export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-24">
      <main className="flex flex-col items-center gap-8">
        <h1 className="text-4xl font-bold tracking-tight">
          Welcome to BrewCrush
        </h1>
        <p className="text-muted-foreground text-center max-w-md">
          The easiest way for small breweries to plan, brew, package, track, and file—from grain to TTB
        </p>
        <div className="flex gap-4">
          <a
            href="/auth/login"
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Sign In
          </a>
          <a
            href="/auth/signup"
            className="rounded-md border border-border px-4 py-2 hover:bg-accent transition-colors"
          >
            Start Free Trial
          </a>
        </div>
      </main>
    </div>
  )
}