"use client";

import { useActionState } from "react";

import { createCompanyForCurrentUser } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(createCompanyForCurrentUser, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Name your company</CardTitle>
        <CardDescription>
          This is where your purchasing history and estimates will live.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="companyName">Company name</Label>
            <Input id="companyName" name="companyName" required autoFocus />
          </div>
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Setting up..." : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
