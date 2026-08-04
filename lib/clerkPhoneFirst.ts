/**
 * Prefers phone number as the default Clerk identifier on SignIn / SignUp.
 *
 * Clerk shows the phone field when `initialValues.phoneNumber` is truthy.
 * A bare "+" has no digits, so PhoneInput clears to an empty national number
 * on mount instead of pre-filling a real number.
 *
 * Apply via `initialValues={clerkPhoneFirstInitialValues}` on `<SignIn>`,
 * `<SignUp>`, `<SignInButton>`, and `<SignUpButton>`.
 */
export const clerkPhoneFirstInitialValues = {
  phoneNumber: "+",
} as const;
