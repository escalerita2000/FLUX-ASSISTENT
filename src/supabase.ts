import { createClient } from '@supabase/supabase-js'

// Credenciales por defecto (con fallback a variables de entorno de Vite)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xzyzymscsespapcduktl.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_uy2RAxaHOLmKbxEc6Nq_TA_7xGanLde'

// URL de la Edge Function (generalmente es la misma URL de Supabase con /functions/v1)
export const EDGE_FUNCTION_URL = `${supabaseUrl}/functions/v1/webauthn`

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
