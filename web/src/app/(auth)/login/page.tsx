import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // /auth/callback redirects here with ?error=... when OAuth fails or is
  // cancelled.
  const { error } = await searchParams;
  return <LoginForm oauthError={error ?? null} />;
}
