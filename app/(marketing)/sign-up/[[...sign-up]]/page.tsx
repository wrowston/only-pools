import { SignUp } from "@clerk/nextjs";
import { POST_AUTH_HOME } from "@/lib/authRoutes";

export const dynamic = "force-static";

export default function SignUpPage() {
  return (
    <div className="op-grid-bg-soft flex flex-1 items-center justify-center px-4 py-16">
      <SignUp
        fallbackRedirectUrl={POST_AUTH_HOME}
        signInFallbackRedirectUrl={POST_AUTH_HOME}
      />
    </div>
  );
}
