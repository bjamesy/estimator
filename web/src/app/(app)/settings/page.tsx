import { listRegisteredPhoneNumbers } from "@/app/actions/phone";
import { getQuickBooksConnectionStatus } from "@/app/actions/quickbooks";

import { PhoneVerificationCard } from "./phone-verification-card";
import { QuickBooksCard } from "./quickbooks-card";

// First (and so far only) settings surface -- SMS receipt intake needs a
// home somewhere that isn't Credentials (vendor license/insurance docs,
// an unrelated domain), so this is a new minimal top-level page rather
// than crowding an existing one. Room to grow if more account-level
// settings show up later.
export default async function SettingsPage() {
  const [numbers, { connected }] = await Promise.all([
    listRegisteredPhoneNumbers(),
    getQuickBooksConnectionStatus(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Account-level configuration for your company.
        </p>
      </div>
      <PhoneVerificationCard registeredNumbers={numbers} />
      <QuickBooksCard connected={connected} />
    </div>
  );
}
