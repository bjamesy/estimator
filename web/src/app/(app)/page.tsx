import { redirect } from "next/navigation";

// No standalone Home dashboard anymore -- Projects and Estimates are now
// full list pages in their own right (status tabs, search), so a separate
// "recent activity" landing page just duplicated them. Every post-login
// redirect still targets "/" (see app/actions/auth.ts, onboarding/page.tsx),
// so this stays as the single place that decides where a logged-in user
// actually lands.
export default function RootPage() {
  redirect("/estimates");
}
