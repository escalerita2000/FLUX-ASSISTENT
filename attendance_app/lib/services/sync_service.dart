import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:hive/hive.dart';
import 'supabase_service.dart';

class SyncService {
  static final Connectivity _connectivity = Connectivity();
  static bool _isSyncing = false;

  // Inicializar listeners de conectividad
  static void init() {
    _connectivity.onConnectivityChanged.listen((List<ConnectivityResult> results) {
      // Si hay conexión móvil o wifi, intentar sincronizar
      if (results.any((result) =>
          result == ConnectivityResult.mobile ||
          result == ConnectivityResult.wifi)) {
        syncOfflineRecords();
        SupabaseService.syncEmployeeSchedule();
      }
    });
  }

  // Guardar registro localmente cuando se escanea el QR
  static Future<void> saveRecordOffline({
    required String? puntoId,
    required DateTime fechaHoraDispositivo,
    required double? latitud,
    required double? longitud,
    required String tipoRegistro,
    required bool gpsValid,
  }) async {
    final box = await Hive.openBox('attendance_logs');
    
    final record = {
      'punto_id': puntoId,
      'fecha_hora_dispositivo': fechaHoraDispositivo.toIso8601String(),
      'latitud': latitud,
      'longitud': longitud,
      'tipo_registro': tipoRegistro,
      'gps_valid': gpsValid,
      'offline_flag': true,
    };

    await box.add(record);

    // Actualizar el estado local para cambiar el botón de la UI inmediatamente
    final settingsBox = Hive.box('settings');
    await settingsBox.put('ultimo_registro_tipo', tipoRegistro);
    await settingsBox.put('ultimo_registro_fecha', fechaHoraDispositivo.toIso8601String());
  }

  // Obtener el conteo de registros pendientes de subir
  static Future<int> getPendingCount() async {
    final box = await Hive.openBox('attendance_logs');
    return box.length;
  }

  // Subir todos los registros guardados localmente a Supabase
  static Future<void> syncOfflineRecords() async {
    if (_isSyncing) return;
    
    // Verificar que realmente tengamos internet
    final connectivityResults = await _connectivity.checkConnectivity();
    if (connectivityResults.every((result) => result == ConnectivityResult.none)) {
      return;
    }

    _isSyncing = true;
    try {
      final box = await Hive.openBox('attendance_logs');
      if (box.isEmpty) {
        _isSyncing = false;
        return;
      }

      final List<dynamic> keys = List.from(box.keys);

      for (var key in keys) {
        final Map<dynamic, dynamic> record = box.get(key);

        final bool success = await SupabaseService.uploadRegistry(
          puntoId: record['punto_id'],
          fechaHoraDispositivo: DateTime.parse(record['fecha_hora_dispositivo']),
          latitud: record['latitud'],
          longitud: record['longitud'],
          tipoRegistro: record['tipo_registro'],
          offlineFlag: record['offline_flag'],
          gpsValid: record['gps_valid'],
        );

        if (success) {
          // Si el servidor lo acepta, lo eliminamos de la cola local
          await box.delete(key);
        } else {
          // Si falló por otra razón (ej. RLS o error de BD), lo conservamos
          // y reintentamos en el siguiente ciclo para no perder el dato.
        }
      }
    } catch (e) {
      // Control de errores de red o estructura
    } finally {
      _isSyncing = false;
    }
  }
}
