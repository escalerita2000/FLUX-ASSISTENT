"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import {
  Fingerprint,
  LogOut,
  RefreshCw,
  AlertTriangle,
  Plus,
  Trash2,
  MapPin,
  Calendar,
  Search,
  Lock,
  Mail,
  UserCheck,
  Download,
  Users,
  QrCode
} from 'lucide-react'
import { supabase } from '../supabase'
import { getCurrentPosition } from '../utils/gps'

export default function AdminPage() {
  const router = useRouter()
  const [session, setSession] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // --- Estados de las Pestañas de Gestión ---
  const [activeTab, setActiveTab] = useState<'empleados' | 'sucursales' | 'asistencias'>('empleados')

  // --- Datos de Gestión ---
  const [empleados, setEmpleados] = useState<any[]>([])
  const [sucursales, setSucursales] = useState<any[]>([])
  const [registros, setRegistros] = useState<any[]>([])

  // --- Formularios Creación ---
  const [newEmpNombre, setNewEmpNombre] = useState('')
  const [newEmpEntrada, setNewEmpEntrada] = useState('08:00')
  const [newEmpSalida, setNewEmpSalida] = useState('17:00')
  const [newEmpDias, setNewEmpDias] = useState<number[]>([1, 2, 3, 4, 5]) // Lunes a Viernes

  const [newSucNombre, setNewSucNombre] = useState('')
  const [newSucLat, setNewSucLat] = useState('')
  const [newSucLng, setNewSucLng] = useState('')
  const [newSucRadio, setNewSucRadio] = useState('15')

  // --- Modal QR ---
  const [showQrModal, setShowQrModal] = useState(false)
  const [qrModalValue, setQrModalValue] = useState('')
  const [qrModalTitle, setQrModalTitle] = useState('')

  // --- Filtros Registros ---
  const [searchQuery, setSearchQuery] = useState('')
  const [filterGps, setFilterGps] = useState<'todos' | 'validos' | 'fuera'>('todos')

  useEffect(() => {
    // Comprobar sesión actual
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        loadAllData()
      }
    })

    // Escuchar cambios de sesión
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        loadAllData()
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const loadAllData = async () => {
    setIsLoading(true)
    try {
      // 1. Cargar Empleados
      const { data: empData } = await supabase
        .from('empleados')
        .select('*')
        .order('nombre', { ascending: true })
      setEmpleados(empData || [])

      // 2. Cargar Sucursales
      const { data: sucData } = await supabase
        .from('puntos_asistencia')
        .select('*')
        .order('nombre', { ascending: true })
      setSucursales(sucData || [])

      // 3. Cargar Asistencias
      const { data: regData } = await supabase
        .from('registros_asistencia')
        .select(`
          id,
          fecha_hora_dispositivo,
          latitud_registro,
          longitud_registro,
          tipo_registro,
          offline_flag,
          gps_valid,
          empleados ( nombre ),
          puntos_asistencia ( nombre )
        `)
        .order('fecha_hora_dispositivo', { ascending: false })
      setRegistros(regData || [])
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setAuthError(null)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    setIsLoading(false)
    if (error) {
      setAuthError('Correo o contraseña incorrectos. Verifica que el usuario administrador exista en Supabase Auth.')
    } else {
      setSession(data.session)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setSession(null)
  }

  // --- Acciones de Empleados ---
  const handleCreateEmpleado = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEmpNombre.trim()) return
    setIsLoading(true)

    // Generar código de vinculación de 6 caracteres
    const codigoVinculacion = Math.random().toString(36).substring(2, 8).toUpperCase()

    const { error } = await supabase.from('empleados').insert({
      nombre: newEmpNombre.trim(),
      codigo_vinculacion: codigoVinculacion,
      hora_entrada: `${newEmpEntrada}:00`,
      hora_salida: `${newEmpSalida}:00`,
      dias_laborales: newEmpDias
    })

    if (error) {
      alert(`Error al registrar empleado: ${error.message}`)
    } else {
      setNewEmpNombre('')
      loadAllData()
    }
    setIsLoading(false)
  }

  const handleDeleteEmpleado = async (id: string, nombre: string) => {
    const confirm = window.confirm(`¿Estás seguro de que deseas eliminar a ${nombre}? Esto borrará sus dispositivos y asistencia vinculados.`)
    if (!confirm) return

    setIsLoading(true)
    const { error } = await supabase.from('empleados').delete().eq('id', id)
    if (error) {
      alert(`Error al eliminar: ${error.message}`)
    } else {
      loadAllData()
    }
    setIsLoading(false)
  }

  const handleToggleDay = (day: number) => {
    setNewEmpDias(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    )
  }

  // --- Acciones de Sucursales ---
  const handleCreateSucursal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSucNombre.trim() || !newSucLat || !newSucLng) return
    setIsLoading(true)

    const { error } = await supabase.from('puntos_asistencia').insert({
      nombre: newSucNombre.trim(),
      latitud: parseFloat(newSucLat),
      longitud: parseFloat(newSucLng),
      radio_metros: parseFloat(newSucRadio) || 15
    })

    if (error) {
      alert(`Error al guardar sucursal: ${error.message}`)
    } else {
      setNewSucNombre('')
      setNewSucLat('')
      setNewSucLng('')
      setNewSucRadio('15')
      loadAllData()
    }
    setIsLoading(false)
  }

  const handleDeleteSucursal = async (id: string, nombre: string) => {
    const confirm = window.confirm(`¿Deseas eliminar la sucursal ${nombre}?`)
    if (!confirm) return

    setIsLoading(true)
    const { error } = await supabase.from('puntos_asistencia').delete().eq('id', id)
    if (error) {
      alert(`Error al eliminar sucursal: ${error.message}`)
    } else {
      loadAllData()
    }
    setIsLoading(false)
  }

  const handleGetLocation = () => {
    setIsLoading(true)
    getCurrentPosition(6000)
      .then(pos => {
        setNewSucLat(pos.coords.latitude.toString())
        setNewSucLng(pos.coords.longitude.toString())
      })
      .catch(err => {
        alert(`No se pudo obtener ubicación: ${err.message}`)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }

  const handleOpenQrModal = (s: any) => {
    const qrValue = JSON.stringify({
      location_id: s.id,
      location_name: s.nombre,
      lat: s.latitud,
      lng: s.longitud,
      radio_metros: s.radio_metros
    })
    setQrModalValue(qrValue)
    setQrModalTitle(s.nombre)
    setShowQrModal(true)
  }

  const handleDownloadQr = () => {
    const svgElement = document.getElementById('qr-svg')
    if (!svgElement) return
    const svgString = new XMLSerializer().serializeToString(svgElement)
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const URL = window.URL || window.webkitURL || window
    const blobURL = URL.createObjectURL(svgBlob)
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 400
      canvas.height = 400
      const context = canvas.getContext('2d')
      if (context) {
        context.fillStyle = '#FFFFFF'
        context.fillRect(0, 0, 400, 400)
        context.drawImage(image, 50, 50, 300, 300)
        const png = canvas.toDataURL('image/png')
        const downloadLink = document.createElement('a')
        downloadLink.href = png
        downloadLink.download = `QR_${qrModalTitle.replace(/\s+/g, '_')}.png`
        document.body.appendChild(downloadLink)
        downloadLink.click()
        document.body.removeChild(downloadLink)
      }
    }
    image.src = blobURL
  }

  // --- Filtrado de Asistencias ---
  const filteredRegistros = registros.filter(r => {
    const empNombre = r.empleados?.nombre || ''
    const matchSearch = empNombre.toLowerCase().includes(searchQuery.toLowerCase())

    if (filterGps === 'validos') {
      return matchSearch && r.gps_valid === true
    } else if (filterGps === 'fuera') {
      return matchSearch && r.gps_valid === false
    }
    return matchSearch
  })

  // =========================================================================
  // LOGIN ADMINISTRACIÓN
  // =========================================================================
  if (!session) {
    return (
      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', justifyContent: 'center', padding: 24, maxWidth: 400, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div className="glass-panel" style={{ padding: '40px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 32, fontWeight: 800, color: 'white', margin: '0 0 8px 0', letterSpacing: '-0.5px' }}>
              FLUX Panel
            </h1>
            <p style={{ color: '#94A3B8', fontSize: 15, margin: 0 }}>
              Ingresa tus credenciales para acceder a la administración del sistema.
            </p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group" style={{ textAlign: 'left' }}>
              <label>Correo Electrónico</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="email"
                  placeholder="admin@empresa.com"
                  className="form-control"
                  style={{ width: '100%', paddingLeft: 40 }}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  required
                />
                <Mail size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#64748B' }} />
              </div>
            </div>

            <div className="form-group" style={{ textAlign: 'left' }}>
              <label>Contraseña</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="form-control"
                  style={{ width: '100%', paddingLeft: 40 }}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
                <Lock size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#64748B' }} />
              </div>
            </div>

            <button type="submit" className="btn-primary" disabled={isLoading} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 }}>
              {isLoading ? <RefreshCw className="animate-spin" size={20} /> : <span>Iniciar Sesión</span>}
            </button>
          </form>

          {authError && (
            <div style={{ display: 'flex', gap: 10, padding: 14, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #EF4444', borderRadius: 16, color: '#FCA5A5', fontSize: 13, textAlign: 'left' }}>
              <AlertTriangle size={20} style={{ flexShrink: 0 }} />
              <span>{authError}</span>
            </div>
          )}

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 16, textAlign: 'center' }}>
            <button
              onClick={() => router.push('/asistencia')}
              className="btn-secondary"
              style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: 8 }}
            >
              <Fingerprint size={16} />
              <span>Ir a Pantalla de Asistencia</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // =========================================================================
  // DASHBOARD ADMINISTRATIVO
  // =========================================================================
  return (
    <div className="admin-container fade-in">
      {/* Header */}
      <header className="admin-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: 'linear-gradient(135deg, #6366F1, #38BDF8)', padding: 8, borderRadius: 10, color: 'white', display: 'flex' }}>
            <UserCheck size={20} />
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.5px', color: 'white' }}>FLUX Admin</span>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => router.push('/asistencia')} className="btn-secondary" style={{ padding: '8px 16px', fontSize: 13 }}>
            Marcado Asistencia
          </button>
          <button onClick={handleLogout} className="btn-danger-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <LogOut size={14} />
            <span>Salir</span>
          </button>
        </div>
      </header>

      {/* Navegación por Pestañas */}
      <nav className="admin-nav">
        <button onClick={() => setActiveTab('empleados')} className={`tab-btn ${activeTab === 'empleados' ? 'active' : ''}`}>
          <Users size={16} />
          <span>Empleados</span>
        </button>
        <button onClick={() => setActiveTab('sucursales')} className={`tab-btn ${activeTab === 'sucursales' ? 'active' : ''}`}>
          <MapPin size={16} />
          <span>Sucursales QR</span>
        </button>
        <button onClick={() => setActiveTab('asistencias')} className={`tab-btn ${activeTab === 'asistencias' ? 'active' : ''}`}>
          <Calendar size={16} />
          <span>Asistencias</span>
        </button>
      </nav>

      {/* Contenido Principal */}
      <main className="admin-main">
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, color: '#6366F1', fontWeight: 600, padding: 40 }}>
            <RefreshCw className="animate-spin" size={24} />
            <span>Actualizando datos...</span>
          </div>
        )}

        {/* =========================================================================
            PESTAÑA 1: EMPLEADOS
            ========================================================================= */}
        {activeTab === 'empleados' && !isLoading && (
          <>
            {/* Formulario de Registro */}
            <div className="table-card">
              <div className="table-header-bar">
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'white' }}>Añadir Nuevo Empleado</h3>
              </div>
              <form onSubmit={handleCreateEmpleado} className="form-panel">
                <div className="form-row">
                  <div className="form-group">
                    <label>Nombre Completo</label>
                    <input
                      type="text"
                      placeholder="Juan Pérez"
                      className="form-control"
                      value={newEmpNombre}
                      onChange={e => setNewEmpNombre(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Hora de Entrada</label>
                    <input
                      type="time"
                      className="form-control"
                      value={newEmpEntrada}
                      onChange={e => setNewEmpEntrada(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Hora de Salida</label>
                    <input
                      type="time"
                      className="form-control"
                      value={newEmpSalida}
                      onChange={e => setNewEmpSalida(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Días Laborales</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day, idx) => {
                      const dayVal = idx + 1
                      const active = newEmpDias.includes(dayVal)
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => handleToggleDay(dayVal)}
                          className="tab-btn"
                          style={{
                            backgroundColor: active ? 'rgba(99,102,241,0.15)' : '#0F172A',
                            color: active ? '#6366F1' : '#64748B',
                            border: `1px solid ${active ? '#6366F1' : '#334155'}`,
                            padding: '8px 12px',
                            borderRadius: '10px'
                          }}
                        >
                          {day}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-start', padding: '12px 24px', fontSize: 14 }}>
                  <Plus size={16} style={{ marginRight: 6 }} />
                  <span>Registrar Empleado</span>
                </button>
              </form>
            </div>

            {/* Listado Empleados */}
            <div className="table-card">
              <div className="table-header-bar">
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'white' }}>Empleados Registrados</h3>
                <span className="text-muted" style={{ fontSize: 13 }}>{empleados.length} empleados en total</span>
              </div>

              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Código Vinculación</th>
                      <th>Entrada</th>
                      <th>Salida</th>
                      <th>Días Laborales</th>
                      <th style={{ width: 80, textAlign: 'center' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empleados.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
                          No hay empleados registrados. Rellena el formulario de arriba.
                        </td>
                      </tr>
                    ) : (
                      empleados.map(emp => (
                        <tr key={emp.id}>
                          <td style={{ fontWeight: 600, color: 'white' }}>{emp.nombre}</td>
                          <td>
                            <code style={{ backgroundColor: 'rgba(99,102,241,0.1)', color: '#38BDF8', padding: '4px 8px', borderRadius: 6, fontSize: 14, fontWeight: 'bold' }}>
                              {emp.codigo_vinculacion}
                            </code>
                          </td>
                          <td>{emp.hora_entrada?.substring(0, 5)}</td>
                          <td>{emp.hora_salida?.substring(0, 5)}</td>
                          <td style={{ color: '#94A3B8' }}>
                            {emp.dias_laborales?.map((d: number) => ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'][d - 1]).join(', ')}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button onClick={() => handleDeleteEmpleado(emp.id, emp.nombre)} className="btn-icon" style={{ color: '#FDA4AF' }} title="Eliminar empleado">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* =========================================================================
            PESTAÑA 2: SUCURSALES (QR)
            ========================================================================= */}
        {activeTab === 'sucursales' && !isLoading && (
          <>
            {/* Formulario Sucursal */}
            <div className="table-card">
              <div className="table-header-bar">
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'white' }}>Añadir Sucursal / Punto de Control</h3>
              </div>
              <form onSubmit={handleCreateSucursal} className="form-panel">
                <div className="form-row">
                  <div className="form-group">
                    <label>Nombre de la Oficina</label>
                    <input
                      type="text"
                      placeholder="Oficina Central"
                      className="form-control"
                      value={newSucNombre}
                      onChange={e => setNewSucNombre(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Latitud</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="19.4326"
                      className="form-control"
                      value={newSucLat}
                      onChange={e => setNewSucLat(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Longitud</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="-99.1332"
                      className="form-control"
                      value={newSucLng}
                      onChange={e => setNewSucLng(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Radio Geofencing (Metros)</label>
                    <input
                      type="number"
                      placeholder="15"
                      className="form-control"
                      value={newSucRadio}
                      onChange={e => setNewSucRadio(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button type="submit" className="btn-primary" style={{ padding: '12px 24px', fontSize: 14 }}>
                    <Plus size={16} style={{ marginRight: 6 }} />
                    <span>Guardar Oficina</span>
                  </button>
                  <button type="button" onClick={handleGetLocation} className="btn-secondary">
                    <MapPin size={16} />
                    <span>Capturar mi Ubicación</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Listado Sucursales */}
            <div className="table-card">
              <div className="table-header-bar">
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'white' }}>Sucursales Configuradas</h3>
                <span className="text-muted" style={{ fontSize: 13 }}>{sucursales.length} sucursales</span>
              </div>

              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Coordenadas (Lat, Lng)</th>
                      <th>Radio</th>
                      <th style={{ width: 140, textAlign: 'center' }}>Código QR</th>
                      <th style={{ width: 80, textAlign: 'center' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sucursales.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
                          No hay oficinas registradas.
                        </td>
                      </tr>
                    ) : (
                      sucursales.map(s => (
                        <tr key={s.id}>
                          <td style={{ fontWeight: 600, color: 'white' }}>{s.nombre}</td>
                          <td>
                            <code style={{ fontSize: 13, color: '#38BDF8' }}>
                              {s.latitud}, {s.longitud}
                            </code>
                          </td>
                          <td>{s.radio_metros} metros</td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              onClick={() => handleOpenQrModal(s)}
                              className="btn-secondary"
                              style={{ padding: '6px 12px', fontSize: 12, display: 'inline-flex', gap: 6 }}
                            >
                              <QrCode size={14} />
                              <span>Ver QR</span>
                            </button>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button onClick={() => handleDeleteSucursal(s.id, s.nombre)} className="btn-icon" style={{ color: '#FDA4AF' }} title="Eliminar sucursal">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* =========================================================================
            PESTAÑA 3: ASISTENCIAS
            ========================================================================= */}
        {activeTab === 'asistencias' && !isLoading && (
          <div className="table-card">
            <div className="table-header-bar">
              <div style={{ display: 'flex', gap: 12, flex: 1, flexWrap: 'wrap' }}>
                <div className="search-control">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="Buscar empleado..."
                    className="form-control"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>

                <select
                  className="form-control"
                  value={filterGps}
                  onChange={e => setFilterGps(e.target.value as any)}
                  style={{ width: 'auto' }}
                >
                  <option value="todos">Todos los registros</option>
                  <option value="validos">Solo dentro de Zona (OK)</option>
                  <option value="fuera">Marcados Fuera de Zona</option>
                </select>
              </div>

              <span className="text-muted" style={{ fontSize: 13 }}>{filteredRegistros.length} registros</span>
            </div>

            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Tipo</th>
                    <th>Fecha y Hora</th>
                    <th>Oficina</th>
                    <th>Tipo Red</th>
                    <th>Firma GPS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRegistros.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
                        No se encontraron registros de asistencia.
                      </td>
                    </tr>
                  ) : (
                    filteredRegistros.map(r => {
                      const dateObj = new Date(r.fecha_hora_dispositivo)
                      const formattedDate = dateObj.toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })

                      return (
                        <tr key={r.id}>
                          <td style={{ fontWeight: 600, color: 'white' }}>{r.empleados?.nombre || 'Desconocido'}</td>
                          <td>
                            <span style={{
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              color: r.tipo_registro === 'entrada' ? '#34D399' : '#F87171'
                            }}>
                              {r.tipo_registro}
                            </span>
                          </td>
                          <td>{formattedDate}</td>
                          <td>{r.puntos_asistencia?.nombre || 'Ubicación específica'}</td>
                          <td>
                            {r.offline_flag ? (
                              <span className="badge warning">Sincronizado Offline</span>
                            ) : (
                              <span className="badge success">En Línea</span>
                            )}
                          </td>
                          <td>
                            {r.gps_valid ? (
                              <span className="badge success">En Zona OK</span>
                            ) : (
                              <span className="badge danger">Fuera de Zona</span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* =========================================================================
          MODAL QR
          ========================================================================= */}
      {showQrModal && (
        <div className="modal-backdrop" onClick={() => setShowQrModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 style={{ color: 'white', margin: '0 0 8px 0', fontSize: 20 }}>Código QR de Asistencia</h3>
            <p style={{ color: '#94A3B8', fontSize: 14, margin: '0 0 24px 0' }}>{qrModalTitle}</p>

            <div style={{ backgroundColor: 'white', padding: 24, borderRadius: 20, display: 'inline-block', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              <QRCodeSVG id="qr-svg" value={qrModalValue} size={250} level="M" includeMargin={true} />
            </div>

            <p style={{ color: '#64748B', fontSize: 12, margin: '16px 0 24px 0' }}>
              Coloca este código impreso en la sucursal para que los empleados lo escaneen al llegar.
            </p>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={handleDownloadQr} className="btn-primary" style={{ flex: 1, padding: '12px 18px', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Download size={16} />
                <span>Descargar PNG</span>
              </button>
              <button onClick={() => setShowQrModal(false)} className="btn-secondary" style={{ flex: 1, padding: '12px 18px', fontSize: 14 }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
