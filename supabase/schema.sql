-- Crear tablas del sistema de asistencia

-- 1. Tabla de Empleados
CREATE TABLE public.empleados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    codigo_vinculacion TEXT UNIQUE NOT NULL, -- Código de 6-8 caracteres para emparejar el celular
    hora_entrada TIME NOT NULL,
    hora_salida TIME NOT NULL,
    dias_laborales INTEGER[] DEFAULT '{1,2,3,4,5}'::INTEGER[], -- 1: Lunes, 5: Viernes, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexar código de vinculación para búsquedas rápidas
CREATE INDEX idx_empleados_codigo_vinculacion ON public.empleados(codigo_vinculacion);

-- 2. Tabla de Dispositivos Vinculados
CREATE TABLE public.dispositivos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empleado_id UUID REFERENCES public.empleados(id) ON DELETE CASCADE UNIQUE, -- Un dispositivo por empleado
    device_uuid TEXT UNIQUE NOT NULL, -- UUID generado en el móvil
    modelo TEXT,
    os_version TEXT,
    vinculado_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexar device_uuid para búsquedas rápidas en el marcado
CREATE INDEX idx_dispositivos_uuid ON public.dispositivos(device_uuid);

-- 3. Tabla de Puntos de Asistencia (Sucursales/Ubicaciones QR)
CREATE TABLE public.puntos_asistencia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    latitud DOUBLE PRECISION NOT NULL,
    longitud DOUBLE PRECISION NOT NULL,
    radio_metros DOUBLE PRECISION DEFAULT 15.0 NOT NULL, -- Margen de error por defecto (ej. 15 metros)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Tabla de Registros de Asistencia
CREATE TABLE public.registros_asistencia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empleado_id UUID REFERENCES public.empleados(id) ON DELETE CASCADE NOT NULL,
    punto_id UUID REFERENCES public.puntos_asistencia(id) ON DELETE SET NULL,
    fecha_hora_dispositivo TIMESTAMP WITH TIME ZONE NOT NULL,
    fecha_hora_servidor TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    latitud_registro DOUBLE PRECISION,
    longitud_registro DOUBLE PRECISION,
    tipo_registro TEXT CHECK (tipo_registro IN ('entrada', 'salida')) NOT NULL,
    offline_flag BOOLEAN DEFAULT FALSE NOT NULL,
    gps_valid BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexar registros por empleado y fecha
CREATE INDEX idx_registros_empleado_fecha ON public.registros_asistencia(empleado_id, fecha_hora_dispositivo DESC);


-- =========================================================================
-- FUNCIONES SEGURAS DE BASE DE DATOS (RPC) PARA LA APP MÓVIL
-- =========================================================================

-- Función para vincular un dispositivo con un empleado usando el código de vinculación
CREATE OR REPLACE FUNCTION public.vincular_dispositivo(
    p_codigo_vinculacion TEXT,
    p_device_uuid TEXT,
    p_modelo TEXT,
    p_os_version TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    mensaje TEXT,
    empleado_nombre TEXT,
    hora_entrada TIME,
    hora_salida TIME,
    dias_laborales INTEGER[]
) 
LANGUAGE plpgsql
SECURITY DEFINER -- Permite ejecutar con privilegios elevados para que el usuario anónimo no requiera permisos directos en tablas
AS $$
DECLARE
    v_empleado_id UUID;
    v_nombre TEXT;
    v_entrada TIME;
    v_salida TIME;
    v_dias INTEGER[];
BEGIN
    -- Buscar el empleado por código (cualificando las columnas para evitar ambigüedades)
    SELECT emp.id, emp.nombre, emp.hora_entrada, emp.hora_salida, emp.dias_laborales
    INTO v_empleado_id, v_nombre, v_entrada, v_salida, v_dias
    FROM public.empleados emp
    WHERE emp.codigo_vinculacion = p_codigo_vinculacion;

    IF v_empleado_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Código de vinculación inválido.'::TEXT, NULL::TEXT, NULL::TIME, NULL::TIME, NULL::INTEGER[];
        RETURN;
    END IF;

    -- Verificar si el dispositivo ya está vinculado a otra persona
    IF EXISTS (SELECT 1 FROM public.dispositivos WHERE device_uuid = p_device_uuid AND empleado_id != v_empleado_id) THEN
        RETURN QUERY SELECT FALSE, 'Este celular ya está vinculado a otro empleado.'::TEXT, NULL::TEXT, NULL::TIME, NULL::TIME, NULL::INTEGER[];
        RETURN;
    END IF;

    -- Registrar o actualizar la vinculación del dispositivo
    INSERT INTO public.dispositivos (empleado_id, device_uuid, modelo, os_version)
    VALUES (v_empleado_id, p_device_uuid, p_modelo, p_os_version)
    ON CONFLICT (empleado_id) 
    DO UPDATE SET device_uuid = p_device_uuid, modelo = p_modelo, os_version = p_os_version, vinculado_at = now();

    RETURN QUERY SELECT TRUE, 'Dispositivo vinculado correctamente.'::TEXT, v_nombre, v_entrada, v_salida, v_dias;
END;
$$;


-- Función para registrar la asistencia desde el dispositivo móvil
CREATE OR REPLACE FUNCTION public.registrar_asistencia(
    p_device_uuid TEXT,
    p_punto_id UUID,
    p_fecha_hora_dispositivo TIMESTAMP WITH TIME ZONE,
    p_latitud DOUBLE PRECISION,
    p_longitud DOUBLE PRECISION,
    p_tipo_registro TEXT,
    p_offline_flag BOOLEAN,
    p_gps_valid BOOLEAN
)
RETURNS TABLE (
    success BOOLEAN,
    mensaje TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_empleado_id UUID;
    v_ultimo_tipo TEXT;
    v_ultimo_tiempo TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Validar que el dispositivo esté vinculado
    SELECT empleado_id INTO v_empleado_id
    FROM public.dispositivos
    WHERE device_uuid = p_device_uuid;

    IF v_empleado_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Dispositivo no vinculado. No se puede registrar.'::TEXT;
        RETURN;
    END IF;

    -- Obtener el último registro del empleado para validar duplicados
    SELECT reg.tipo_registro, reg.fecha_hora_dispositivo INTO v_ultimo_tipo, v_ultimo_tiempo
    FROM public.registros_asistencia reg
    WHERE reg.empleado_id = v_empleado_id
    ORDER BY reg.fecha_hora_dispositivo DESC
    LIMIT 1;

    -- Validaciones de lógica de negocio (Turno de máximo 16 horas)
    IF p_tipo_registro = 'entrada' THEN
        -- Si ya hay una entrada activa en las últimas 16 horas, bloquear
        IF v_ultimo_tipo = 'entrada' AND v_ultimo_tiempo >= (p_fecha_hora_dispositivo - INTERVAL '16 hours') THEN
            RETURN QUERY SELECT FALSE, 'Ya tienes un registro de entrada activo.'::TEXT;
            RETURN;
        END IF;
    ELSIF p_tipo_registro = 'salida' THEN
        -- Si no hay entrada activa en las últimas 16 horas (ej: la última acción fue salida, o la entrada expiró)
        IF v_ultimo_tipo IS NULL OR v_ultimo_tipo = 'salida' OR v_ultimo_tiempo < (p_fecha_hora_dispositivo - INTERVAL '16 hours') THEN
            RETURN QUERY SELECT FALSE, 'No tienes una entrada activa para registrar salida.'::TEXT;
            RETURN;
        END IF;
    ELSE
        RETURN QUERY SELECT FALSE, 'Tipo de registro inválido.'::TEXT;
        RETURN;
    END IF;

    -- Insertar el registro de asistencia
    INSERT INTO public.registros_asistencia (
        empleado_id,
        punto_id,
        fecha_hora_dispositivo,
        latitud_registro,
        longitud_registro,
        tipo_registro,
        offline_flag,
        gps_valid
    ) VALUES (
        v_empleado_id,
        p_punto_id,
        p_fecha_hora_dispositivo,
        p_latitud,
        p_longitud,
        p_tipo_registro,
        p_offline_flag,
        p_gps_valid
    );

    RETURN QUERY SELECT TRUE, 'Asistencia registrada correctamente.'::TEXT;
END;
$$;


-- Función para obtener el último registro de asistencia de un dispositivo
CREATE OR REPLACE FUNCTION public.obtener_ultimo_registro(p_device_uuid TEXT)
RETURNS TABLE (
    tipo_registro TEXT,
    fecha_hora_dispositivo TIMESTAMP WITH TIME ZONE
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_empleado_id UUID;
BEGIN
    -- Validar que el dispositivo esté vinculado
    SELECT empleado_id INTO v_empleado_id
    FROM public.dispositivos
    WHERE device_uuid = p_device_uuid;

    IF v_empleado_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT reg.tipo_registro, reg.fecha_hora_dispositivo
    FROM public.registros_asistencia reg
    WHERE reg.empleado_id = v_empleado_id
    ORDER BY reg.fecha_hora_dispositivo DESC
    LIMIT 1;
END;
$$;


-- Función para obtener los detalles del empleado y su horario mediante su device_uuid
CREATE OR REPLACE FUNCTION public.obtener_info_empleado(p_device_uuid TEXT)
RETURNS TABLE (
    nombre TEXT,
    hora_entrada TIME,
    hora_salida TIME,
    dias_laborales INTEGER[]
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT emp.nombre, emp.hora_entrada, emp.hora_salida, emp.dias_laborales
    FROM public.empleados emp
    JOIN public.dispositivos disp ON disp.empleado_id = emp.id
    WHERE disp.device_uuid = p_device_uuid;
END;
$$;


-- Habilitar Row Level Security (RLS) por seguridad
ALTER TABLE public.empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispositivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_asistencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_asistencia ENABLE ROW LEVEL SECURITY;

-- Políticas para permitir operaciones al rol de administrador (autenticado) y restringir el acceso público directo
-- Los administradores (autenticados) tienen control total
CREATE POLICY admin_all_empleados ON public.empleados TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY admin_all_dispositivos ON public.dispositivos TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY admin_all_puntos ON public.puntos_asistencia TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY admin_all_registros ON public.registros_asistencia TO authenticated USING (true) WITH CHECK (true);

-- Permisos públicos mínimos
-- Las llamadas a funciones RPC definidas arriba tienen 'SECURITY DEFINER', por lo que saltan las restricciones directas de RLS controladamente.
-- Esto permite que la app funcione sin tener que exponer las tablas completas públicamente de forma insegura.
CREATE POLICY public_read_puntos ON public.puntos_asistencia FOR SELECT TO anon USING (true);
