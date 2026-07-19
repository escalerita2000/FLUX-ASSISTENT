// Script para mantener activa la base de datos de Supabase (Evitar pausa automática del plan gratuito)
// Se realiza una consulta REST externa que simula tráfico real de la aplicación.

const supabaseUrl = process.env.SUPABASE_URL || 'https://xzyzymscsespapcduktl.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_uy2RAxaHOLmKbxEc6Nq_TA_7xGanLde';

async function keepAlive() {
  console.log(`[${new Date().toISOString()}] Iniciando ping de actividad a Supabase...`);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/puntos_asistencia?limit=1`, {
      method: 'GET',
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      console.log(`[${new Date().toISOString()}] Ping exitoso. La base de datos está activa. Código: ${response.status}`);
    } else {
      console.error(`[${new Date().toISOString()}] Fallo en el ping. Código: ${response.status}`);
      const text = await response.text();
      console.error('Detalles del error:', text);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error de conexión:`, error);
  }
}

keepAlive();
