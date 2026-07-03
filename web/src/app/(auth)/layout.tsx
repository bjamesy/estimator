export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        {/* Product wordmark above the form so the auth screen reads as the
            front door of the app rather than a bare card. */}
        <div className="text-center">
          <p className="text-2xl font-semibold text-primary">Estimator</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your purchasing history, turned into faster estimates.
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
