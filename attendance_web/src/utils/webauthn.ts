import { startRegistration, startAuthentication } from '@simplewebauthn/browser'
import { EDGE_FUNCTION_URL } from '../supabase'

/**
 * Registra un nuevo dispositivo móvil asociando una credencial biométrica (huella dactilar/rostro) en el Enclave Seguro.
 */
export async function registerBiometrics(
  codigoVinculacion: string,
  deviceUuid: string,
  modelo: string,
  osVersion: string
): Promise<{
  success: boolean
  empleadoNombre: string
  horaEntrada: string
  horaSalida: string
  diasLaborales: number[]
  credentialID: string
}> {
  // 1. Obtener opciones de registro del servidor
  const optionsRes = await fetch(`${EDGE_FUNCTION_URL}/register-options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigoVinculacion, deviceUuid }),
  })

  if (!optionsRes.ok) {
    const errData = await optionsRes.json()
    throw new Error(errData.error || 'Error al obtener opciones de registro')
  }

  const optionsJSON = await optionsRes.json()

  // 2. Activar indicador biométrico nativo del celular
  let attestationResponse
  try {
    attestationResponse = await startRegistration({ optionsJSON })
  } catch (err: any) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Registro cancelado o bloqueado por el usuario.')
    }
    throw new Error(`Error en el lector de huella: ${err.message}`)
  }

  // 3. Enviar respuesta del dispositivo al servidor para validación criptográfica y vinculación
  const verifyRes = await fetch(`${EDGE_FUNCTION_URL}/register-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      codigoVinculacion,
      deviceUuid,
      modelo,
      osVersion,
      attestationResponse,
    }),
  })

  if (!verifyRes.ok) {
    const errData = await verifyRes.json()
    throw new Error(errData.error || 'Error al verificar registro biométrico')
  }

  const result = await verifyRes.json()
  return result
}

/**
 * Autentica al empleado mediante su huella dactilar y registra su asistencia (soporta online y offline).
 */
export async function authenticateBiometrics(
  deviceUuid: string,
  puntoId: string | null,
  latitud: number | null,
  longitud: number | null,
  tipoRegistro: 'entrada' | 'salida',
  offlineFlag: boolean,
  gpsValid: boolean,
  localChallenge?: string,
  credentialID?: string
): Promise<{ success: boolean; mensaje: string; expectedChallenge?: string; assertionResponse?: any }> {
  const fechaHoraDispositivo = new Date().toISOString()

  // CASO OFFLINE: Autenticación puramente local
  if (offlineFlag) {
    if (!localChallenge || !credentialID) {
      throw new Error('Faltan datos de desafío local o credencial para el modo offline.')
    }

    // Configurar opciones de WebAuthn localmente
    const localOptions = {
      challenge: localChallenge,
      rpId: window.location.hostname,
      allowCredentials: [{
        id: credentialID,
        type: 'public-key' as const,
        transports: ['internal' as const],
      }],
      userVerification: 'required' as const,
    }

    let assertionResponse
    try {
      assertionResponse = await startAuthentication({ optionsJSON: localOptions })
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        throw new Error('Escaneo de huella cancelado.')
      }
      throw new Error(`Error al pedir huella localmente: ${err.message}`)
    }

    // Retornamos el resultado firmado para guardarlo en la cola de sincronización
    return {
      success: true,
      mensaje: 'Huella verificada localmente (Offline). Guardado en cola de sincronización.',
      expectedChallenge: localChallenge,
      assertionResponse,
    }
  }

  // CASO ONLINE: Flujo estándar interactivo con el servidor
  // 1. Obtener opciones del servidor
  const optionsRes = await fetch(`${EDGE_FUNCTION_URL}/login-options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceUuid }),
  })

  if (!optionsRes.ok) {
    const errData = await optionsRes.json()
    throw new Error(errData.error || 'Error al iniciar opciones de autenticación')
  }

  const optionsJSON = await optionsRes.json()

  // 2. Activar indicador biométrico nativo
  let assertionResponse
  try {
    assertionResponse = await startAuthentication({ optionsJSON })
  } catch (err: any) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Escaneo de huella cancelado.')
    }
    throw new Error(`Error en el lector de huella: ${err.message}`)
  }

  // 3. Enviar firma y datos a verificar al servidor para registrar asistencia
  const verifyRes = await fetch(`${EDGE_FUNCTION_URL}/login-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceUuid,
      assertionResponse,
      puntoId,
      fechaHoraDispositivo,
      latitud,
      longitud,
      tipoRegistro,
      offlineFlag: false,
      gpsValid,
    }),
  })

  if (!verifyRes.ok) {
    const errData = await verifyRes.json()
    throw new Error(errData.error || 'Fallo al verificar huella o registrar asistencia')
  }

  const result = await verifyRes.json()
  return result
}
