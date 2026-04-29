import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

let clientPromise;

export async function getSupabaseConfig() {
  const response = await fetch("/api/config");
  const config = await response.json().catch(() => ({}));
  return {
    configured: Boolean(config.supabaseUrl && config.supabaseAnonKey),
    supabaseUrl: config.supabaseUrl || "",
    supabaseAnonKey: config.supabaseAnonKey || "",
  };
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

