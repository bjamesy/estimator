"use client";

import { useState, useTransition } from "react";

import {
  removePhoneNumber,
  sendPhoneVerificationCode,
  verifyPhoneCode,
} from "@/app/actions/phone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RegisteredNumber = { phoneNumber: string; verifiedAt: string };

export function PhoneVerificationCard({
  registeredNumbers,
}: {
  registeredNumbers: RegisteredNumber[];
}) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [verifying, startVerifying] = useTransition();
  const [removing, startRemoving] = useTransition();

  function handleSendCode() {
    setError(null);
    startSending(async () => {
      const { error } = await sendPhoneVerificationCode(phone);
      if (error) {
        setError(error);
        return;
      }
      setCodeSent(true);
    });
  }

  function handleVerify() {
    setError(null);
    startVerifying(async () => {
      const { error } = await verifyPhoneCode(phone, code);
      if (error) {
        setError(error);
        return;
      }
      setPhone("");
      setCode("");
      setCodeSent(false);
    });
  }

  function handleRemove(number: string) {
    startRemoving(async () => {
      await removePhoneNumber(number);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>SMS receipt intake</CardTitle>
        <CardDescription>
          Text a photo of a receipt or invoice to add it to your company&apos;s records. Register
          the phone number you&apos;ll text from — only verified numbers are recognized.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {registeredNumbers.length > 0 && (
          <div className="flex flex-col gap-2">
            {registeredNumbers.map((n) => (
              <div
                key={n.phoneNumber}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
              >
                <span>{n.phoneNumber}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={removing}
                  onClick={() => handleRemove(n.phoneNumber)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>
              Phone number
              <Input
                type="tel"
                placeholder="+15551234567"
                value={phone}
                disabled={codeSent}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Label>
          </div>

          {!codeSent ? (
            <Button
              type="button"
              disabled={sending || phone.length === 0}
              onClick={handleSendCode}
              className="self-start"
            >
              Send code
            </Button>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>
                  Verification code
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </Label>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  disabled={verifying || code.length === 0}
                  onClick={handleVerify}
                >
                  Verify
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setCodeSent(false);
                    setCode("");
                    setError(null);
                  }}
                >
                  Use a different number
                </Button>
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
