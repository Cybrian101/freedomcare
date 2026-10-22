"use client";
import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { signIn, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-4">
      <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" required />
      <Input label="Password" name="password" type="password" autoComplete="current-password" required />
      {state.error && (
        <p role="alert" className="rounded-xl bg-bad-bg text-bad-fg px-4 py-3 text-sm font-semibold">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" full loading={pending}>
        Sign in
      </Button>
    </form>
  );
}
