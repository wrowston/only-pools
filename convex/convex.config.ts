import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    SPORTS_DATA_PROVIDER: v.optional(v.string()),
    API_SPORTS_KEY: v.optional(v.string()),
  },
});
