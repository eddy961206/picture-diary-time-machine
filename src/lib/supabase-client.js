import { createClient } from "@supabase/supabase-js";

let configPromise;
let clientPromise;

export async function getSupabaseConfig() {
  if (!configPromise) {
    configPromise = fetch("/api/config", { cache: "no-store" })
      .then((response) => response.json())
      .catch(() => ({}))
      .then((config) => ({
        configured: Boolean(config.supabaseUrl && config.supabaseAnonKey),
        supabaseUrl: config.supabaseUrl || "",
        supabaseAnonKey: config.supabaseAnonKey || "",
        kakaoJavaScriptKey: config.kakaoJavaScriptKey || "",
        authRequiredForGenerate: config.authRequiredForGenerate !== false,
      }));
  }
  return configPromise;
}

export async function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = getSupabaseConfig().then((config) => {
      if (!config.configured) return null;
      return createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    });
  }
  return clientPromise;
}
