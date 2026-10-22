import { Suspense } from "react";
import { RegisterFlow } from "./RegisterFlow";

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterFlow />
    </Suspense>
  );
}
