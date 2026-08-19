"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useTransition } from "react";
import { toast } from "sonner";

import { connectQuickBooks, disconnectQuickBooks } from "@/app/actions/quickbooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function QuickBooksCard({ connected }: { connected: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connecting, startConnecting] = useTransition();
  const [disconnecting, startDisconnecting] = useTransition();

  // The OAuth callback (web/src/app/api/quickbooks/callback/route.ts)
  // redirects back here with a one-time query param since it can't
  // render its own UI -- surface it once, then clean the URL so a
  // refresh doesn't re-show it.
  useEffect(() => {
    const qboError = searchParams.get("qbo_error");
    const qboConnected = searchParams.get("qbo_connected");
    if (qboError) {
      toast.error("QuickBooks connection failed", { description: qboError });
      router.replace("/settings");
    } else if (qboConnected) {
      toast.success("QuickBooks connected");
      router.replace("/settings");
    }
  }, [searchParams, router]);

  function handleConnect() {
    startConnecting(async () => {
      const { url, error } = await connectQuickBooks();
      if (error || !url) {
        toast.error("Couldn't start connection", { description: error ?? undefined });
        return;
      }
      window.location.href = url;
    });
  }

  function handleDisconnect() {
    startDisconnecting(async () => {
      const { error } = await disconnectQuickBooks();
      if (error) {
        toast.error("Couldn't disconnect", { description: error });
        return;
      }
      toast.success("QuickBooks disconnected");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>QuickBooks Online</CardTitle>
        <CardDescription>
          Push a signed (or draft) estimate version as a real Invoice in your QuickBooks company.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {connected ? (
          <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
            <span>Connected</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disconnecting}
              onClick={handleDisconnect}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <Button type="button" disabled={connecting} onClick={handleConnect}>
            {connecting ? "Redirecting..." : "Connect QuickBooks"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
