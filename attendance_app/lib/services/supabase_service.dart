import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:hive/hive.dart';
import 'package:uuid/uuid.dart';
import 'dart:io';
import 'notification_service.dart';

class SupabaseService {
  static SupabaseClient get client => Supabase.instance.client;

  // Inicializar Supabase y configurar el UUID del dispositivo
  static Future<void> init({
    required String supabaseUrl,
    required String supabaseAnonKey,
  }) async {
    await Supabase.initialize(
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
    );

    // Inicializar configuración del dispositivo
    var box = await Hive.openBox('settings');
    if (box.get('device_uuid') == null) {
      // Generar y almacenar un UUID persistente para este celular
      const uuidGen = Uuid();
      final String newUuid = uuidGen.v4();
      await box.put('device_uuid', newUuid);
    }
  }

  // Obtener el UUID persistente de este celular
  static String getDeviceUuid() {
    var box = Hive.box('settings');
    return box.get('device_uuid', defaultValue: '') as String;
  }

  // Verificar si el celular ya está vinculado a un empleado
  static bool isLinked() {
    var box = Hive.box('settings');
    return box.get('linked', defaultValue: false) as bool;
  }

  // Vincular el dispositivo con un código
  static Future<Map<String, dynamic>> bindDevice(String codigo) async {
    try {
      final deviceUuid = getDeviceUuid();
      
      // Obtener detalles básicos del dispositivo físico
      String model = Platform.isAndroid ? 'Android Device' : 'iOS Device';
      String osVersion = Platform.operatingSystemVersion;

      // Intentar llamar al RPC de Supabase para vincular
      final List<dynamic> response = await client.rpc(
        'vincular_dispositivo',
        params: {
          'p_codigo_vinculacion': codigo,
          'p_device_uuid': deviceUuid,
          'p_modelo': model,
          'p_os_version': osVersion,
        },
      );

      if (response.isNotEmpty) {
        final result = response[0] as Map<String, dynamic>;
        final bool success = result['success'] ?? false;

        if (success) {
          // Guardar configuración localmente
          var box = Hive.box('settings');
          await box.put('linked', true);
          await box.put('empleado_nombre', result['empleado_nombre']);
          await box.put('hora_entrada', result['hora_entrada']);
          await box.put('hora_salida', result['hora_salida']);
          
          // Guardar lista de días laborales
          final List<dynamic>? rawDays = result['dias_laborales'];
          final List<int> days = rawDays?.map((e) => e as int).toList() ?? [1, 2, 3, 4, 5];
          await box.put('dias_laborales', days);

          // Programar notificaciones locales según horario (no crítico)
          try {
            await NotificationService.scheduleAttendanceReminders(
              empleadoNombre: result['empleado_nombre'],
              horaEntradaStr: result['hora_entrada'],
              diasLaborales: days,
            );
          } catch (e) {
            // Las notificaciones no deben bloquear la vinculación
          }

          // Descargar y guardar en caché local los puntos de asistencia
          try {
            await cachePuntosAsistencia();
          } catch (e) {
            // El caché no debe bloquear la vinculación
          }

          // Sincronizar último registro de asistencia si existe
          try {
            await syncLastRegistration();
          } catch (e) {
            // No bloquear vinculación
          }
        }

        return {
          'success': success,
          'mensaje': result['mensaje'] ?? 'Error desconocido',
        };
      }
      return {'success': false, 'mensaje': 'Sin respuesta del servidor'};
    } catch (e) {
      return {'success': false, 'mensaje': 'Error de conexión: $e'};
    }
  }

  // Desvincular dispositivo (opción de reset local)
  static Future<void> unlinkDevice() async {
    var box = Hive.box('settings');
    await box.put('linked', false);
    await box.delete('empleado_nombre');
    await box.delete('hora_entrada');
    await box.delete('hora_salida');
    await box.delete('dias_laborales');
    await box.delete('ultimo_registro_tipo');
    await box.delete('ultimo_registro_fecha');
    await NotificationService.cancelAllNotifications();
  }

  // Enviar un registro de asistencia a Supabase
  static Future<bool> uploadRegistry({
    required String? puntoId,
    required DateTime fechaHoraDispositivo,
    required double? latitud,
    required double? longitud,
    required String tipoRegistro,
    required bool offlineFlag,
    required bool gpsValid,
  }) async {
    try {
      final deviceUuid = getDeviceUuid();

      final List<dynamic> response = await client.rpc(
        'registrar_asistencia',
        params: {
          'p_device_uuid': deviceUuid,
          'p_punto_id': puntoId,
          'p_fecha_hora_dispositivo': fechaHoraDispositivo.toIso8601String(),
          'p_latitud': latitud,
          'p_longitud': longitud,
          'p_tipo_registro': tipoRegistro,
          'p_offline_flag': offlineFlag,
          'p_gps_valid': gpsValid,
        },
      );

      if (response.isNotEmpty) {
        // El servidor procesó el registro (puede ser exitoso o rechazado por validación de duplicados)
        // Retornamos true para que se elimine de la cola offline de pendientes
        return true;
      }
      return false;
    } catch (e) {
      // Error de red o servidor
      return false;
    }
  }

  // Sincronizar el horario actual del empleado desde el servidor si hay internet
  static Future<void> syncEmployeeSchedule() async {
    if (!isLinked()) return;
    try {
      final deviceUuid = getDeviceUuid();
      final List<dynamic> response = await client.rpc(
        'obtener_info_empleado',
        params: {'p_device_uuid': deviceUuid},
      );

      if (response.isNotEmpty) {
        final result = response[0] as Map<String, dynamic>;
        var box = Hive.box('settings');
        await box.put('empleado_nombre', result['nombre']);
        await box.put('hora_entrada', result['hora_entrada']);
        await box.put('hora_salida', result['hora_salida']);
        
        final List<dynamic>? rawDays = result['dias_laborales'];
        final List<int> days = rawDays?.map((e) => e as int).toList() ?? [1, 2, 3, 4, 5];
        await box.put('dias_laborales', days);

        // Actualizar recordatorios locales
        await NotificationService.scheduleAttendanceReminders(
          empleadoNombre: result['nombre'],
          horaEntradaStr: result['hora_entrada'],
          diasLaborales: days,
        );
      }

      // Descargar y guardar en caché local la lista de puntos de asistencia (oficinas)
      await cachePuntosAsistencia();
      
      // Sincronizar el último registro
      await syncLastRegistration();
    } catch (e) {
      // Ignorar fallas si está offline
    }
  }

  // Descargar y guardar en caché local la lista de puntos de asistencia (oficinas)
  static Future<void> cachePuntosAsistencia() async {
    try {
      final List<dynamic> response = await client
          .from('puntos_asistencia')
          .select('id, nombre, latitud, longitud, radio_metros');
      
      final box = await Hive.openBox('puntos_asistencia');
      await box.clear();
      if (response.isNotEmpty) {
        for (var p in response) {
          await box.add(Map<String, dynamic>.from(p));
        }
      }
    } catch (e) {
      // Ignorar errores (por ejemplo, si está offline)
    }
  }

  // Sincronizar el último registro desde Supabase
  static Future<void> syncLastRegistration() async {
    if (!isLinked()) return;
    try {
      final deviceUuid = getDeviceUuid();
      final List<dynamic> response = await client.rpc(
        'obtener_ultimo_registro',
        params: {'p_device_uuid': deviceUuid},
      );

      if (response.isNotEmpty) {
        final result = response[0] as Map<String, dynamic>;
        final String? tipo = result['tipo_registro'];
        final String? fechaStr = result['fecha_hora_dispositivo'];

        if (tipo != null && fechaStr != null) {
          final box = Hive.box('settings');
          await box.put('ultimo_registro_tipo', tipo);
          await box.put('ultimo_registro_fecha', fechaStr);
        }
      }
    } catch (e) {
      // Ignorar si el RPC no existe o está offline
    }
  }
}
