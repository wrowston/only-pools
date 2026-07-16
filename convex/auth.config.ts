export default {
  providers: [
    {
      // Set via: bunx convex env set CLERK_JWT_ISSUER_DOMAIN https://<clerk-frontend-api>
      // Same value as Clerk Frontend API URL (Convex Clerk integration page).
      //
      // Clerk Dashboard checklist for this ticket:
      // 1. Activate Convex integration → JWT template named "convex"
      // 2. Require email + phone verification on the Clerk application
      // 3. In the Convex JWT template claims, include at least:
      //    email, email_verified, phone_number, phone_number_verified,
      //    sid ({{session.id}}) for mid-session vs new-sign-in policy,
      //    and picture ({{user.image_url}}) for standings avatars
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
};
