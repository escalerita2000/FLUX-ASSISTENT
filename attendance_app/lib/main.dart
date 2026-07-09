import 'package:flutter/material.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'services/supabase_service.dart';
import 'services/notification_service.dart';
import 'services/sync_service.dart';
import 'screens/home_screen.dart';
import 'screens/linking_screen.dart';
import 'screens/permissions_screen.dart';

// Configura aquí tus credenciales de Supabase
const String supabaseUrl = 'https://xzyzymscsespapcduktl.supabase.co';
const String supabaseAnonKey = 'sb_publishable_uy2RAxaHOLmKbxEc6Nq_TA_7xGanLde';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 0. Inicializar locale para fechas en español
  await initializeDateFormatting('es_ES', null);

  // 1. Inicializar almacenamiento local Hive (crítico)
  try {
    await Hive.initFlutter();
    await Hive.openBox('settings');
  } catch (e) {
    // Si Hive falla, la app no puede continuar pero al menos no da pantalla blanca
    runApp(const _ErrorApp(message: 'Error al inicializar almacenamiento local.'));
    return;
  }

  // 2. Inicializar el servicio de Notificaciones Locales (no crítico)
  try {
    await NotificationService.init();
  } catch (e) {
    // Las notificaciones no son críticas; la app funciona sin ellas
  }

  // 3. Inicializar Supabase (no debe bloquear la app si no hay internet)
  try {
    await SupabaseService.init(
      supabaseUrl: supabaseUrl,
      supabaseAnonKey: supabaseAnonKey,
    );
  } catch (e) {
    // Si Supabase falla al inicializar, seguir con la app (funciona offline)
  }

  // 4. Inicializar escuchador de sincronización en segundo plano (no crítico)
  try {
    SyncService.init();
  } catch (e) {
    // Si el sync falla al arrancar, seguir
  }

  runApp(const AttendanceApp());
}

class AttendanceApp extends StatelessWidget {
  const AttendanceApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Determinar la pantalla inicial basada en si está vinculado o no
    bool isLinked = false;
    try {
      isLinked = SupabaseService.isLinked();
    } catch (e) {
      // Si hay error leyendo Hive, asumir no vinculado
    }

    // La pantalla destino tras permisos
    final Widget destination =
        isLinked ? const HomeScreen() : const LinkingScreen();

    return MaterialApp(
      title: 'FLUX Register',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF6366F1), // Indigo
          brightness: Brightness.dark,
        ),
        fontFamily: 'Roboto',
      ),
      // Siempre pasar por la pantalla de permisos primero
      // Si ya están concedidos, avanza automáticamente en ~300ms
      home: PermissionsScreen(destination: destination),
    );
  }
}

// Widget de emergencia si el arranque falla totalmente
class _ErrorApp extends StatelessWidget {
  final String message;
  const _ErrorApp({required this.message});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        backgroundColor: const Color(0xFF0F172A),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.error_outline_rounded,
                    color: Colors.redAccent, size: 72),
                const SizedBox(height: 24),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Intenta cerrar y volver a abrir la aplicación.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
