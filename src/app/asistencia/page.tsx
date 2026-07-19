"use client"

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Html5Qrcode } from 'html5-qrcode'
import {
  Fingerprint,
  QrCode,
  LogOut,
  RefreshCw,
  Cloud,
  CloudOff,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Camera,
  ArrowLeft
} from 'lucide-react'
import { supabase } from '../../supabase'
import { registerBiometrics, authenticateBiometrics } from '../../utils/webauthn'
import { calculateDistance, getCurrentPosition } from '../../utils/gps'
import {
  saveOfflineLog,
  saveCachedPuntos,
  getCachedPuntos,
  getOfflineLogs
} from '../../utils/db'
import type { PuntoAsistencia } from '../../utils/db'
import { syncOfflineRecords } from '../../utils/sync'

export default function AsistenciaPage() {
  const router = useRouter()

  // --- Estados de Vinculación ---
  const [isLinked, setIsLinked] = useState<boolean>(false)
  const [employeeName, setEmployeeName] = useState<string>('')
  const [deviceUuid, setDeviceUuid] = useState<string>('')
  const [linkingCode, setLinkingCode] = useState('')
  const [credentialID, setCredentialID] = useState<string>('')
  const [isClientMounted, setIsClientMounted] = useState(false)

  // --- Estados del Scanner ---
  const [cameraError, setCameraError] = useState<string | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)

  // --- Estados del Proceso / UI ---
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)

  // --- Estados del Overlay de Resultado ---
  const [showResultOverlay, setShowResultOverlay] = useState(false)
  const [resultStatus, setResultStatus] = useState<'success' | 'warning' | 'error' | null>(null)
  const [resultTitle, setResultTitle] = useState('')
  const [resultBody, setResultBody] = useState('')
  const [recordTypeForStyle, setRecordTypeForStyle] = useState<'entrada' | 'salida'>('entrada')

  // --- Determinar el tipo de registro automáticamente ---
  const getNextRecordType = (): 'entrada' | 'salida' => {
    if (typeof window === 'undefined') return 'entrada'
    const lastType = localStorage.getItem('ultimo_registro_tipo')
    const lastTimeStr = localStorage.getItem('ultimo_registro_fecha')

    if (lastType === 'entrada' && lastTimeStr) {
      const lastTime = new Date(lastTimeStr)
      const diffHours = (new Date().getTime() - lastTime.getTime()) / (1000 * 60 * 60)
      if (diffHours < 16) {
        return 'salida'
      }
    }
    return 'entrada'
  }

  const [currentActionType, setCurrentActionType] = useState<'entrada' | 'salida'>('entrada')

  // --- Cargar estados del cliente ---
  useEffect(() => {
    setIsClientMounted(true)
    setIsOnline(navigator.onLine)

    const linked = localStorage.getItem('isLinked') === 'true'
    setIsLinked(linked)
    setEmployeeName(localStorage.getItem('empleado_nombre') || '')
    setCredentialID(localStorage.getItem('credentialID') || '')

    let uuid = localStorage.getItem('device_uuid')
    if (!uuid) {
      uuid = crypto.randomUUID()
      localStorage.setItem('device_uuid', uuid)
    }
    setDeviceUuid(uuid)

    getOfflineLogs().then((logs) => setPendingSyncCount(logs.length))

    if (navigator.onLine && linked) {
      triggerSync(uuid)
    }

    const syncInterval = setInterval(() => {
      if (navigator.onLine && linked) {
        triggerSync(uuid)
      }
    }, 15000)

    const handleOnline = () => {
      setIsOnline(true)
      triggerSync(uuid)
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(syncInterval)
    }
  }, [isLinked])

  // --- Inicializar Cámara Automáticamente al estar Vinculado ---
  useEffect(() => {
    if (isLinked && !showResultOverlay && isClientMounted) {
      setCurrentActionType(getNextRecordType())
      startScanner()
    }

    return () => {
      stopScanner()
    }
  }, [isLinked, showResultOverlay, isClientMounted])

  const triggerSync = async (uuidVal: string = deviceUuid) => {
    if (!navigator.onLine || !uuidVal) return
    await syncOfflineRecords(uuidVal, setPendingSyncCount)
    try {
      const { data: puntos } = await supabase
        .from('puntos_asistencia')
        .select('id, nombre, latitud, longitud, radio_metros')
      if (puntos) {
        await saveCachedPuntos(puntos as PuntoAsistencia[])
      }
    } catch (e) {
      console.warn('Fallo al descargar puntos de asistencia actualizados:', e)
    }
  }

  const startScanner = async () => {
    setCameraError(null)

    setTimeout(async () => {
      try {
        if (scannerRef.current) {
          await stopScanner()
        }

        const html5QrCode = new Html5Qrcode('reader')
        scannerRef.current = html5QrCode

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: (width, height) => {
              const size = Math.min(width, height) * 0.65
              return { width: size, height: size }
            }
          },
          (decodedText) => {
            handleQrCodeScanned(decodedText)
          },
          () => {}
        )
      } catch (err: any) {
        console.error('Error al iniciar la cámara:', err)
        setCameraError(err.message || 'No pudimos acceder a la cámara. Concede permisos.')
      }
    }, 150)
  }

  const stopScanner = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop()
      } catch (e) {
        console.warn('Error al detener la cámara:', e)
      }
      scannerRef.current = null
    }
  }

  const handleQrCodeScanned = async (qrData: string) => {
    await stopScanner()

    const recordType = getNextRecordType()
    setRecordTypeForStyle(recordType)
    setIsLoading(true)
    setStatusMessage('Obteniendo ubicación GPS...')

    let lat: number | null = null
    let lng: number | null = null
    let locationId: string | null = null
    let locationName = 'Punto Físico'
    let geoFenceThreshold = 15.0
    let distanceInMeters = 0.0
    let gpsValid = false

    try {
      const position = await getCurrentPosition(8000)
      lat = position.coords.latitude
      lng = position.coords.longitude
    } catch (err: any) {
      showResult({
        status: 'error',
        title: 'Error de Localización',
        body: err.message || 'No pudimos obtener coordenadas GPS. Activa tu ubicación.'
      })
      return
    }

    try {
      const parsedData = JSON.parse(qrData)

      if (parsedData.type === 'attendance_global') {
        setStatusMessage('Calculando oficina más cercana...')
        const cachedPoints = await getCachedPuntos()
        if (cachedPoints.length === 0 && navigator.onLine) {
          const { data } = await supabase
            .from('puntos_asistencia')
            .select('id, nombre, latitud, longitud, radio_metros')
          if (data && data.length > 0) {
            await saveCachedPuntos(data as PuntoAsistencia[])
            cachedPoints.push(...(data as PuntoAsistencia[]))
          }
        }

        if (cachedPoints.length === 0) {
          showResult({
            status: 'error',
            title: 'Sin Oficinas',
            body: 'No hay oficinas registradas localmente. Conéctate a internet para sincronizar.'
          })
          return
        }

        let minDistance = Infinity
        let closestPoint: PuntoAsistencia | null = null

        for (const p of cachedPoints) {
          const dist = calculateDistance(lat, lng, p.latitud, p.longitud)
          if (dist < minDistance) {
            minDistance = dist
            closestPoint = p
          }
        }

        if (!closestPoint) throw new Error('Error al determinar la sucursal más cercana.')

        locationId = closestPoint.id
        locationName = closestPoint.nombre
        geoFenceThreshold = closestPoint.radio_metros
        distanceInMeters = minDistance
        gpsValid = distanceInMeters <= geoFenceThreshold
      } else {
        locationId = parsedData.location_id
        locationName = parsedData.location_name || 'Sucursal'
        const qrLat = Number(parsedData.lat)
        const qrLng = Number(parsedData.lng)
        geoFenceThreshold = Number(parsedData.radio_metros || 15)

        distanceInMeters = calculateDistance(lat, lng, qrLat, qrLng)
        gpsValid = distanceInMeters <= geoFenceThreshold
      }
    } catch (e) {
      showResult({
        status: 'error',
        title: 'Código QR Inválido',
        body: 'El código QR no corresponde a una oficina autorizada.'
      })
      return
    }

    setStatusMessage('Escaneando huella digital...')
    const offlineFlag = !navigator.onLine

    try {
      if (offlineFlag) {
        const localChallenge = btoa(
          String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))
        )
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '')

        const authResult = await authenticateBiometrics(
          deviceUuid,
          locationId,
          lat,
          lng,
          recordType,
          true,
          gpsValid,
          localChallenge,
          credentialID
        )

        await saveOfflineLog({
          puntoId: locationId,
          fechaHoraDispositivo: new Date().toISOString(),
          latitud: lat,
          longitud: lng,
          tipoRegistro: recordType,
          offlineFlag: true,
          gpsValid,
          expectedChallenge: authResult.expectedChallenge,
          assertionResponse: authResult.assertionResponse
        })

        const logs = await getOfflineLogs()
        setPendingSyncCount(logs.length)

        localStorage.setItem('ultimo_registro_tipo', recordType)
        localStorage.setItem('ultimo_registro_fecha', new Date().toISOString())

        if (gpsValid) {
          showResult({
            status: 'success',
            title: recordType === 'entrada' ? '¡Entrada Registrada!' : '¡Salida Registrada!',
            body: `Verificado localmente. Registrado en ${locationName}. Se sincronizará al recuperar señal.`
          })
        } else {
          showResult({
            status: 'warning',
            title: 'Registro Fuera de Zona',
            body: `Verificado (Offline). Estás a ${Math.round(distanceInMeters)} metros de ${locationName}. Se guardó con advertencia.`
          })
        }
      } else {
        const authResult = await authenticateBiometrics(
          deviceUuid,
          locationId,
          lat,
          lng,
          recordType,
          false,
          gpsValid
        )

        if (authResult.success) {
          localStorage.setItem('ultimo_registro_tipo', recordType)
          localStorage.setItem('ultimo_registro_fecha', new Date().toISOString())

          if (gpsValid) {
            showResult({
              status: 'success',
              title: recordType === 'entrada' ? '¡Entrada Registrada!' : '¡Salida Registrada!',
              body: `Hola, ${employeeName}. Marcado guardado exitosamente en ${locationName}.`
            })
          } else {
            showResult({
              status: 'warning',
              title: 'Registro Fuera de Zona',
              body: `Registrado con advertencia. Estás a ${Math.round(distanceInMeters)} metros de ${locationName}.`
            })
          }
        }
      }
    } catch (err: any) {
      console.error(err)
      showResult({
        status: 'error',
        title: 'Fallo de Autenticación',
        body: err.message || 'La verificación biométrica no se completó.'
      })
    }
  }

  const showResult = ({
    status,
    title,
    body
  }: {
    status: 'success' | 'warning' | 'error'
    title: string
    body: string
  }) => {
    setIsLoading(false)
    setStatusMessage(null)
    setResultStatus(status)
    setResultTitle(title)
    setResultBody(body)
    setShowResultOverlay(true)

    setTimeout(() => {
      setShowResultOverlay(false)
    }, 4500)
  }

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!linkingCode.trim()) return

    setIsLoading(true)
    setError(null)
    setStatusMessage('Iniciando vinculación biométrica...')

    const userAgent = navigator.userAgent
    let model = 'Web Browser'
    let osVersion = 'Unknown OS'

    if (/Android/i.test(userAgent)) {
      model = 'Android Device'
      osVersion = 'Android'
    } else if (/iPhone|iPad/i.test(userAgent)) {
      model = 'iOS Device'
      osVersion = 'iOS'
    }

    try {
      const result = await registerBiometrics(linkingCode.trim(), deviceUuid, model, osVersion)

      localStorage.setItem('isLinked', 'true')
      localStorage.setItem('empleado_nombre', result.empleadoNombre)
      localStorage.setItem('hora_entrada', result.horaEntrada)
      localStorage.setItem('hora_salida', result.horaSalida)
      localStorage.setItem('dias_laborales', JSON.stringify(result.diasLaborales))
      localStorage.setItem('credentialID', result.credentialID)

      setIsLinked(true)
      setEmployeeName(result.empleadoNombre)
      setCredentialID(result.credentialID)
      setIsLoading(false)
      setStatusMessage(null)

      const { data: puntos } = await supabase
        .from('puntos_asistencia')
        .select('id, nombre, latitud, longitud, radio_metros')
      if (puntos) {
        await saveCachedPuntos(puntos as PuntoAsistencia[])
      }
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Error de conexión al vincular el dispositivo.')
      setIsLoading(false)
      setStatusMessage(null)
    }
  }

  const handleUnlink = () => {
    const confirm = window.confirm(
      '¿Estás seguro de que deseas desvincular este dispositivo? Perderás las credenciales biométricas guardadas localmente.'
    )
    if (confirm) {
      localStorage.clear()
      setIsLinked(false)
      setEmployeeName('')
      setCredentialID('')
      setCurrentActionType('entrada')
    }
  }

  if (!isClientMounted) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A', color: 'white' }}>
        <RefreshCw className="animate-spin" size={32} color="#6366F1" />
      </div>
    )
  }

  if (!isLinked) {
    return (
      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', justifyContent: 'center', padding: 24, maxWidth: 420, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div className="glass-panel" style={{ padding: '40px 32px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          <div style={{ textAlign: 'left' }}>
            <button
              onClick={() => router.push('/')}
              className="btn-secondary"
              style={{ padding: '8px 12px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            >
              <ArrowLeft size={14} />
              <span>Volver a Admin</span>
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ padding: 18, background: 'rgba(99, 102, 241, 0.15)', borderRadius: 24, color: '#6366F1' }}>
              <QrCode size={56} />
            </div>
          </div>

          <div>
            <h1 style={{ fontSize: 28, margin: '0 0 8px 0', fontWeight: 800, color: 'white', letterSpacing: '-0.5px' }}>
              Vincular Dispositivo
            </h1>
            <p style={{ color: '#94A3B8', fontSize: 15, margin: 0 }}>
              Ingresa el código proporcionado por el administrador para registrar tu huella y activar el celular.
            </p>
          </div>

          <form onSubmit={handleLink} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <input
              type="text"
              placeholder="CÓDIGO DE VINCULACIÓN"
              className="input-field"
              value={linkingCode}
              onChange={(e) => setLinkingCode(e.target.value.toUpperCase())}
              disabled={isLoading}
              required
            />

            <button type="submit" className="btn-primary" disabled={isLoading} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {isLoading ? (
                <RefreshCw className="animate-spin" size={20} />
              ) : (
                <>
                  <Fingerprint size={20} />
                  <span>Vincular Dispositivo</span>
                </>
              )}
            </button>
          </form>

          {error && (
            <div style={{ display: 'flex', gap: 10, padding: 14, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #EF4444', borderRadius: 16, color: '#FCA5A5', fontSize: 13, textAlign: 'left' }}>
              <AlertTriangle size={20} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {isLoading && statusMessage && (
            <div style={{ color: '#38BDF8', fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <RefreshCw className="animate-spin" size={16} />
              <span>{statusMessage}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="scanner-container">
      <div id="reader" style={{ flex: 1 }}></div>

      <div className="scanner-overlay">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 15 }}>
          <div className="glass-panel" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, borderRadius: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: isOnline ? '#10B981' : '#F59E0B' }}></div>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>{employeeName}</span>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => triggerSync(deviceUuid)}
              className="glass-panel"
              style={{
                border: 'none',
                color: pendingSyncCount > 0 ? '#F59E0B' : '#10B981',
                padding: 10,
                borderRadius: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              {isOnline ? <Cloud size={18} /> : <CloudOff size={18} />}
              {pendingSyncCount > 0 && (
                <span style={{ fontSize: 12, fontWeight: 700 }}>{pendingSyncCount}</span>
              )}
            </button>

            <button
              onClick={handleUnlink}
              className="glass-panel"
              style={{ border: 'none', color: '#FDA4AF', padding: 10, borderRadius: 14, cursor: 'pointer' }}
              title="Desvincular celular"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {!showResultOverlay && (
          <div className={`scanner-frame ${currentActionType}`}>
            <div className="scanner-laser"></div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', zIndex: 15, textAlign: 'center' }}>
          {isLoading && statusMessage ? (
            <div className="glass-panel" style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12, borderRadius: 18, color: '#38BDF8', fontWeight: 600 }}>
              <RefreshCw className="animate-spin" size={18} />
              <span>{statusMessage}</span>
            </div>
          ) : (
            <div className="glass-panel" style={{ padding: '14px 24px', borderRadius: 18, border: '1px solid rgba(255,255,255,0.05)' }}>
              <p style={{ margin: 0, fontSize: 13, textTransform: 'uppercase', letterSpacing: '2px', color: currentActionType === 'entrada' ? '#34D399' : '#F87171', fontWeight: 800 }}>
                Escaneando {currentActionType}
              </p>
              <p style={{ margin: '4px 0 0 0', fontSize: 14, color: '#94A3B8' }}>
                Apunta al código QR de asistencia en la pantalla
              </p>
            </div>
          )}

          {cameraError && (
            <div className="glass-panel" style={{ padding: '12px 20px', borderRadius: 16, background: 'rgba(239,68,68,0.25)', color: '#FCA5A5', fontSize: 13, maxWidth: 300, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Camera size={20} style={{ flexShrink: 0 }} />
              <span>{cameraError}</span>
            </div>
          )}
        </div>
      </div>

      {showResultOverlay && resultStatus && (
        <div
          className={`result-overlay ${
            resultStatus === 'success'
              ? recordTypeForStyle === 'entrada'
                ? 'success'
                : 'salida'
              : resultStatus
          } fade-in`}
        >
          {resultStatus === 'success' && <CheckCircle2 size={100} color="white" />}
          {resultStatus === 'warning' && <AlertTriangle size={100} color="white" />}
          {resultStatus === 'error' && <ShieldCheck size={100} color="white" />}

          <h2 style={{ fontSize: 32, fontWeight: 900, margin: '24px 0 8px 0', color: 'white' }}>
            {resultTitle}
          </h2>
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.85)', margin: 0, maxWidth: 320, lineHeight: 1.4 }}>
            {resultBody}
          </p>

          <button
            onClick={() => setShowResultOverlay(false)}
            style={{
              marginTop: 40,
              backgroundColor: 'white',
              color: 'black',
              border: 'none',
              padding: '14px 32px',
              borderRadius: 14,
              fontWeight: 700,
              fontSize: 16,
              cursor: 'pointer',
              boxShadow: '0 4px 10px rgba(0,0,0,0.1)'
            }}
          >
            Entendido
          </button>
        </div>
      )}
    </div>
  )
}
