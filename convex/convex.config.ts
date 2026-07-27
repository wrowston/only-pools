import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    SPORTS_DATA_PROVIDER: v.optional(v.string()),
    API_SPORTS_KEY: v.optional(v.string()),
    PRODUCTION_OPERATOR_CLERK_USER_ID: v.optional(v.string()),
    PRODUCTION_OPERATOR_TOKEN_IDENTIFIER: v.optional(v.string()),
    DEPLOYMENT_KIND: v.optional(v.string()),
    CLEAN_ACTIVATION_DEPLOYMENT_ID: v.optional(v.string()),
  },
});
