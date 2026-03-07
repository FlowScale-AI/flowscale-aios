/**
 * Pre-register Lucide icons with @iconify/react so they work offline
 * in the Electron desktop build (no API calls needed).
 *
 * Import this module once at app startup (e.g. in providers.tsx).
 */
import { addCollection } from "@iconify/react";
import lucide from "@iconify-json/lucide/icons.json";

addCollection(lucide);
