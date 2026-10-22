import Image from "next/image";
import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-5 py-10 bg-gradient-to-b from-white to-teal-50/60">
      <div className="w-full max-w-sm animate-fade-up">
        <Image src="/logo.png" alt="Freedom Trust" width={385} height={182} priority className="mx-auto h-24 w-auto" />
        <p className="text-center text-ink-muted font-medium mt-3 mb-8">Delivering Freedom Through Care.</p>
        <div className="rounded-card border border-line bg-white shadow-card p-5">
          <h1 className="text-xl font-extrabold mb-4">Volunteer sign in</h1>
          <LoginForm />
        </div>
        <p className="text-center text-xs text-ink-muted mt-6">Gram Vikalang Punarjanmam · Chennai Camp, 24 Oct 2026</p>
      </div>
    </main>
  );
}
