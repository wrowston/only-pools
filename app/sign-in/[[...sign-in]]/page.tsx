import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="op-grid-bg-soft flex flex-1 items-center justify-center px-4 py-16">
      <SignIn />
    </div>
  );
}
