import { getOfflineLogs, deleteOfflineLog } from './db'
import { EDGE_FUNCTION_URL } from '../supabase'

let isSyncing = false

/**
 * Intenta subir todos los registros de asistencia acumulados en IndexedDB cuando hay conexión.
 */
export async function syncOfflineRecords(
  deviceUuid: string,
  onProgress?: (pendingCount: number) => void
): Promise<void> {
  if (isSyncing) return
  if (!navigator.onLine) return

  const logs = await getOfflineLogs()
  if (logs.length === 0) {
    if (onProgress) onProgress(0)
    return
  }

  isSyncing = true
  try {
    for (const log of logs) {
      try {
        const response = await fetch(`${EDGE_FUNCTION_URL}/login-verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceUuid,
            assertionResponse: log.assertionResponse,
            puntoId: log.puntoId,
            fechaHoraDispositivo: log.fechaHoraDispositivo,
            latitud: log.latitud,
            longitud: log.longitud,
            tipoRegistro: log.tipoRegistro,
            offlineFlag: true,
            gpsValid: log.gpsValid,
            expectedChallenge: log.expectedChallenge,
          }),
        })

        if (response.ok) {
          // Registro guardado con éxito en Supabase, lo removemos de IndexedDB
          if (log.id !== undefined) {
            await deleteOfflineLog(log.id)
          }
        }
      } catch (err) {
        console.error('Fallo en sincronizar un registro individual:', err)
        // Si hay error de red, pausamos la sincronización para reintentar después
        break
      }
    }
  } finally {
    isSyncing = false
    const remainingLogs = await getOfflineLogs()
    if (onProgress) {
      onProgress(remainingLogs.length)
    }
  }
}
