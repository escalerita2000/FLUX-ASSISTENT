-- SQL Migration Script to transition from Flutter mobile to WebAuthn PWA

-- 1. Agregar columnas a la tabla de dispositivos para WebAuthn
ALTER TABLE public.dispositivos 
ADD COLUMN IF NOT EXISTS credential_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS credential_public_key TEXT,
ADD COLUMN IF NOT EXISTS counter INTEGER DEFAULT 0 NOT NULL;

-- 2. Crear tabla de desafíos para WebAuthn
CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empleado_id UUID REFERENCES public.empleados(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Indexar desafíos por empleado
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_empleado ON public.webauthn_challenges(empleado_id);

-- Habilitar RLS en la tabla de desafíos
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para webauthn_challenges
CREATE POLICY admin_all_challenges ON public.webauthn_challenges TO authenticated USING (true) WITH CHECK (true);

-- 3. Actualizar la función RPC para vinculación de dispositivos con WebAuthn
CREATE OR REPLACE FUNCTION public.vincular_dispositivo(
    p_codigo_vinculacion TEXT,
    p_device_uuid TEXT,
    p_modelo TEXT,
    p_os_version TEXT,
    p_credential_id TEXT,
    p_credential_public_key TEXT
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
SECURITY DEFINER
AS $$
DECLARE
    v_empleado_id UUID;
    v_nombre TEXT;
    v_entrada TIME;
    v_salida TIME;
    v_dias INTEGER[];
BEGIN
    SELECT emp.id, emp.nombre, emp.hora_entrada, emp.hora_salida, emp.dias_laborales
    INTO v_empleado_id, v_nombre, v_entrada, v_salida, v_dias
    FROM public.empleados emp
    WHERE emp.codigo_vinculacion = p_codigo_vinculacion;

    IF v_empleado_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Código de vinculación inválido.'::TEXT, NULL::TEXT, NULL::TIME, NULL::TIME, NULL::INTEGER[];
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM public.dispositivos WHERE device_uuid = p_device_uuid AND empleado_id != v_empleado_id) THEN
        RETURN QUERY SELECT FALSE, 'Este celular ya está vinculado a otro empleado.'::TEXT, NULL::TEXT, NULL::TIME, NULL::TIME, NULL::INTEGER[];
        RETURN;
    END IF;

    INSERT INTO public.dispositivos (empleado_id, device_uuid, modelo, os_version, credential_id, credential_public_key)
    VALUES (v_empleado_id, p_device_uuid, p_modelo, p_os_version, p_credential_id, p_credential_public_key)
    ON CONFLICT (empleado_id) 
    DO UPDATE SET 
        device_uuid = p_device_uuid, 
        modelo = p_modelo, 
        os_version = p_os_version, 
        credential_id = p_credential_id, 
        credential_public_key = p_credential_public_key, 
        vinculado_at = now();

    RETURN QUERY SELECT TRUE, 'Dispositivo vinculado correctamente.'::TEXT, v_nombre, v_entrada, v_salida, v_dias;
END;
$$;
