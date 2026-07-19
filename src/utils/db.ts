const DB_NAME = 'flux_db'
const DB_VERSION = 1

export interface OfflineLog {
  id?: number
  puntoId: string | null
  fechaHoraDispositivo: string
  latitud: number | null
  longitud: number | null
  tipoRegistro: 'entrada' | 'salida'
  offlineFlag: boolean
  gpsValid: boolean
  expectedChallenge?: string
  assertionResponse?: any
}

export interface PuntoAsistencia {
  id: string
  nombre: string
  latitud: number
  longitud: number
  radio_metros: number
}

export function initDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('attendance_logs')) {
        db.createObjectStore('attendance_logs', { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains('puntos_asistencia')) {
        db.createObjectStore('puntos_asistencia', { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveOfflineLog(log: OfflineLog): Promise<number> {
  const db = await initDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('attendance_logs', 'readwrite')
    const store = transaction.objectStore('attendance_logs')
    const request = store.add(log)

    request.onsuccess = () => resolve(request.result as number)
    request.onerror = () => reject(request.error)
  })
}

export async function getOfflineLogs(): Promise<OfflineLog[]> {
  const db = await initDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('attendance_logs', 'readonly')
    const store = transaction.objectStore('attendance_logs')
    const request = store.getAll()

    request.onsuccess = () => resolve(request.result as OfflineLog[])
    request.onerror = () => reject(request.error)
  })
}

export async function deleteOfflineLog(id: number): Promise<void> {
  const db = await initDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('attendance_logs', 'readwrite')
    const store = transaction.objectStore('attendance_logs')
    const request = store.delete(id)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function saveCachedPuntos(puntos: PuntoAsistencia[]): Promise<void> {
  const db = await initDb()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('puntos_asistencia', 'readwrite')
    const store = transaction.objectStore('puntos_asistencia')
    
    // Limpiar caché anterior
    const clearRequest = store.clear()
    
    clearRequest.onsuccess = () => {
      if (puntos.length === 0) {
        resolve()
        return
      }
      
      let count = 0
      puntos.forEach((punto) => {
        const addRequest = store.put(punto)
        addRequest.onsuccess = () => {
          count++
          if (count === puntos.length) {
            resolve()
          }
        }
        addRequest.onerror = () => reject(addRequest.error)
      })
    }
    
    clearRequest.onerror = () => reject(clearRequest.error)
  })
}

export async function getCachedPuntos(): Promise<PuntoAsistencia[]> {
  const db = await initDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('puntos_asistencia', 'readonly')
    const store = transaction.objectStore('puntos_asistencia')
    const request = store.getAll()

    request.onsuccess = () => resolve(request.result as PuntoAsistencia[])
    request.onerror = () => reject(request.error)
  })
}
