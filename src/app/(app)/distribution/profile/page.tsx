"use client";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BeneficiaryProfile } from "@/components/desk/BeneficiaryProfile";

// One static URL (/distribution/profile?id=...) so the service worker can cache a single shell that works
// for every beneficiary while offline.
function Profile() {
  const id = useSearchParams().get("id");
  if (!id) {
    return (
      <p className="m-4 rounded-lg bg-red-50 p-3 text-red-800">
        No beneficiary selected. <Link href="/distribution" className="underline">Back to search</Link>
      </p>
    );
  }
  return <BeneficiaryProfile key={id} id={id} />;
}

export default function BeneficiaryPage() {
  return (
    <Suspense fallback={<p className="p-4 text-slate-500">Loading...</p>}>
      <Profile />
    </Suspense>
  );
}
