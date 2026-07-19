import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "npm:@simplewebauthn/server@9.0.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  // Manejar preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname;

    // Crear cliente de Supabase con Service Role para evadir RLS temporalmente en la validación biométrica
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Obtener RP ID dinámicamente del origen (e.g. localhost o app.flux.com)
    const origin = req.headers.get("origin") || "";
    let rpID = "localhost";
    if (origin) {
      try {
        const originUrl = new URL(origin);
        rpID = originUrl.hostname;
      } catch (_e) {
        // Ignorar error de url
      }
    }

    // =========================================================================
    // RUTA 1: GENERAR OPCIONES DE REGISTRO (VINCULACIÓN)
    // =========================================================================
    if (path.endsWith("/register-options") && req.method === "POST") {
      const { codigoVinculacion, deviceUuid } = await req.json();

      if (!codigoVinculacion || !deviceUuid) {
        return new Response(JSON.stringify({ error: "Faltan parámetros" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Buscar el empleado asociado al código de vinculación
      const { data: empleado, error: empError } = await supabaseClient
        .from("empleados")
        .select("id, nombre")
        .eq("codigo_vinculacion", codigoVinculacion)
        .single();

      if (empError || !empleado) {
        return new Response(JSON.stringify({ error: "Código de vinculación inválido" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Generar opciones de WebAuthn
      const options = await generateRegistrationOptions({
        rpName: "FLUX Assistent",
        rpID,
        userID: empleado.id,
        userName: empleado.nombre,
        userDisplayName: empleado.nombre,
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
          authenticatorAttachment: "platform", // Forzar huella/FaceID del dispositivo
        },
      });

      // Guardar el desafío en la base de datos
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutos de validez
      const { error: chalError } = await supabaseClient
        .from("webauthn_challenges")
        .insert({
          empleado_id: empleado.id,
          challenge: options.challenge,
          expires_at: expiresAt,
        });

      if (chalError) {
        throw new Error("No se pudo registrar el desafío de seguridad");
      }

      return new Response(JSON.stringify(options), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // =========================================================================
    // RUTA 2: VERIFICAR REGISTRO Y VINCULAR DISPOSITIVO
    // =========================================================================
    if (path.endsWith("/register-verify") && req.method === "POST") {
      const { codigoVinculacion, deviceUuid, modelo, osVersion, attestationResponse } = await req.json();

      // Obtener el ID del empleado a partir del código
      const { data: empleado, error: empError } = await supabaseClient
        .from("empleados")
        .select("id, nombre")
        .eq("codigo_vinculacion", codigoVinculacion)
        .single();

      if (empError || !empleado) {
        return new Response(JSON.stringify({ error: "Empleado no encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Obtener el desafío guardado
      const { data: challengeObj, error: chalError } = await supabaseClient
        .from("webauthn_challenges")
        .select("id, challenge")
        .eq("empleado_id", empleado.id)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (chalError || !challengeObj) {
        return new Response(JSON.stringify({ error: "Desafío de seguridad no encontrado o expirado. Reintente." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verificar la respuesta del dispositivo usando simplewebauthn
      const verification = await verifyRegistrationResponse({
        response: attestationResponse,
        expectedChallenge: challengeObj.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return new Response(JSON.stringify({ error: "Fallo en la verificación biométrica" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { credentialPublicKey, credentialID, counter } = verification.registrationInfo;

      // Convertir credenciales a base64url para almacenamiento en base de datos
      const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(credentialPublicKey)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
      const credentialIDBase64 = credentialID;

      // Consumir el desafío (eliminarlo)
      await supabaseClient.from("webauthn_challenges").delete().eq("id", challengeObj.id);

      // Llamar al RPC vincular_dispositivo para registrar/actualizar
      const { data: linkResult, error: linkError } = await supabaseClient.rpc(
        "vincular_dispositivo",
        {
          p_codigo_vinculacion: codigoVinculacion,
          p_device_uuid: deviceUuid,
          p_modelo: modelo,
          p_os_version: osVersion,
          p_credential_id: credentialIDBase64,
          p_credential_public_key: publicKeyBase64,
        }
      );

      if (linkError || !linkResult || !linkResult[0]?.success) {
        return new Response(JSON.stringify({ error: linkError?.message || linkResult[0]?.mensaje || "Error al vincular" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        empleadoNombre: linkResult[0].empleado_nombre,
        horaEntrada: linkResult[0].hora_entrada,
        horaSalida: linkResult[0].hora_salida,
        diasLaborales: linkResult[0].dias_laborales,
        credentialID: credentialIDBase64,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // =========================================================================
    // RUTA 3: GENERAR OPCIONES DE INICIO DE SESIÓN (ASISTENCIA)
    // =========================================================================
    if (path.endsWith("/login-options") && req.method === "POST") {
      const { deviceUuid } = await req.json();

      if (!deviceUuid) {
        return new Response(JSON.stringify({ error: "Falta el identificador de dispositivo" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Buscar el dispositivo vinculado
      const { data: disp, error: dispError } = await supabaseClient
        .from("dispositivos")
        .select("empleado_id, credential_id")
        .eq("device_uuid", deviceUuid)
        .single();

      if (dispError || !disp) {
        return new Response(JSON.stringify({ error: "Dispositivo no vinculado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Generar opciones de autenticación
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: [{
          id: disp.credential_id,
          type: "public-key",
          transports: ["internal"],
        }],
        userVerification: "required",
      });

      // Guardar desafío
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const { error: chalError } = await supabaseClient
        .from("webauthn_challenges")
        .insert({
          empleado_id: disp.empleado_id,
          challenge: options.challenge,
          expires_at: expiresAt,
        });

      if (chalError) {
        throw new Error("Error al guardar desafío de inicio de sesión");
      }

      return new Response(JSON.stringify(options), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // =========================================================================
    // RUTA 4: VERIFICAR HUELLA Y REGISTRAR ASISTENCIA
    // =========================================================================
    if (path.endsWith("/login-verify") && req.method === "POST") {
      const { deviceUuid, assertionResponse, puntoId, fechaHoraDispositivo, latitud, longitud, tipoRegistro, offlineFlag, gpsValid, expectedChallenge } = await req.json();

      // Buscar el dispositivo y la clave pública
      const { data: disp, error: dispError } = await supabaseClient
        .from("dispositivos")
        .select("empleado_id, credential_id, credential_public_key, counter")
        .eq("device_uuid", deviceUuid)
        .single();

      if (dispError || !disp) {
        return new Response(JSON.stringify({ error: "Dispositivo no vinculado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Obtener el desafío activo o el desafío firmado offline
      let challengeToVerify = "";
      let challengeIdToClean = null;

      if (offlineFlag && expectedChallenge) {
        challengeToVerify = expectedChallenge;
      } else {
        const { data: challengeObj, error: chalError } = await supabaseClient
          .from("webauthn_challenges")
          .select("id, challenge")
          .eq("empleado_id", disp.empleado_id)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (chalError || !challengeObj) {
          return new Response(JSON.stringify({ error: "Desafío de seguridad inválido o expirado" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        challengeToVerify = challengeObj.challenge;
        challengeIdToClean = challengeObj.id;
      }

      // Reconstruir la clave pública guardada de base64url a Uint8Array
      const publicKeyBinary = new Uint8Array(
        atob(disp.credential_public_key.replace(/-/g, "+").replace(/_/g, "/"))
          .split("")
          .map((c) => c.charCodeAt(0))
      );

      // Verificar la firma de la huella dactilar
      const verification = await verifyAuthenticationResponse({
        response: assertionResponse,
        expectedChallenge: challengeToVerify,
        expectedOrigin: origin,
        expectedRPID: rpID,
        authenticator: {
          credentialID: disp.credential_id,
          credentialPublicKey: publicKeyBinary,
          counter: disp.counter,
        },
      });

      if (!verification.verified) {
        return new Response(JSON.stringify({ error: "Fallo en verificación de huella dactilar" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Actualizar el contador del dispositivo para evitar replays
      const newCounter = verification.authenticationInfo.newCounter;
      await supabaseClient
        .from("dispositivos")
        .update({ counter: newCounter })
        .eq("device_uuid", deviceUuid);

      // Consumir el desafío (si era online)
      if (challengeIdToClean) {
        await supabaseClient.from("webauthn_challenges").delete().eq("id", challengeIdToClean);
      }

      // Registrar asistencia usando el RPC existente
      const { data: recordResult, error: recordError } = await supabaseClient.rpc(
        "registrar_asistencia",
        {
          p_device_uuid: deviceUuid,
          p_punto_id: puntoId,
          p_fecha_hora_dispositivo: fechaHoraDispositivo,
          p_latitud: latitud,
          p_longitud: longitud,
          p_tipo_registro: tipoRegistro,
          p_offline_flag: offlineFlag,
          p_gps_valid: gpsValid,
        }
      );

      if (recordError || !recordResult || !recordResult[0]?.success) {
        return new Response(
          JSON.stringify({ error: recordError?.message || recordResult[0]?.mensaje || "Error al guardar asistencia en BD" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          mensaje: recordResult[0].mensaje,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Ruta desconocida
    return new Response(JSON.stringify({ error: "No encontrado" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
