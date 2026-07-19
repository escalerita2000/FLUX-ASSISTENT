/**
 * Calcula la distancia en metros entre dos coordenadas geográficas utilizando la fórmula de Haversine.
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3 // Radio de la Tierra en metros
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c // Retorna distancia en metros
}

/**
 * Obtiene la ubicación actual del navegador del celular de forma asíncrona con alta precisión.
 */
export function getCurrentPosition(timeoutMs = 10000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('La geolocalización no está soportada por este navegador.'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      (error) => {
        let message = 'Error al obtener la ubicación.'
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = 'Permiso de ubicación denegado. Actívalo en la configuración de tu navegador.'
            break
          case error.POSITION_UNAVAILABLE:
            message = 'La ubicación no está disponible (verifica si el GPS está activado).'
            break
          case error.TIMEOUT:
            message = 'Tiempo de espera agotado al obtener la ubicación GPS.'
            break
        }
        reject(new Error(message))
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      }
    )
  })
}
