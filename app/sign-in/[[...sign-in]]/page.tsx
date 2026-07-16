import { SignIn } from "@clerk/nextjs";
import { POST_AUTH_HOME } from "@/lib/authRoutes";

export default function SignInPage() {
  return (
    <div className="op-grid-bg-soft flex flex-1 items-center justify-center px-4 py-16">
      <SignIn
        fallbackRedirectUrl={POST_AUTH_HOME}
        signUpFallbackRedirectUrl={POST_AUTH_HOME}
      />
    </div>
  );
}
