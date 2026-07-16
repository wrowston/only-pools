import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="op-grid-bg-soft flex flex-1 items-center justify-center px-4 py-16">
      <SignUp />
    </div>
  );
}
