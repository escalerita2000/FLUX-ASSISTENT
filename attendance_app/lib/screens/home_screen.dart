import 'package:flutter/material.dart';
import 'package:hive/hive.dart';
import 'dart:async';
import 'package:intl/intl.dart';
import '../services/supabase_service.dart';
import '../services/sync_service.dart';
import 'linking_screen.dart';
import 'scanner_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String _employeeName = '';
  int _pendingSyncCount = 0;
  Timer? _syncCheckTimer;
  bool _isSyncingNow = false;

  @override
  void initState() {
    super.initState();
    _loadSettings();
    _checkPendingCount();
    
    // Timer para monitorear registros pendientes de sincronizar
    _syncCheckTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      _checkPendingCount();
    });

    // Intentar sincronizar al abrir la app
    _triggerSync();
  }

  @override
  void dispose() {
    _syncCheckTimer?.cancel();
    super.dispose();
  }

  void _loadSettings() {
    final box = Hive.box('settings');
    setState(() {
      _employeeName = box.get('empleado_nombre', defaultValue: 'Empleado') as String;
    });
  }

  String _getCurrentRegistrationType() {
    final box = Hive.box('settings');
    final String? tipo = box.get('ultimo_registro_tipo') as String?;
    final String? fechaStr = box.get('ultimo_registro_fecha') as String?;

    if (tipo == 'entrada' && fechaStr != null) {
      final fecha = DateTime.tryParse(fechaStr);
      if (fecha != null) {
        final diff = DateTime.now().difference(fecha);
        // Regla de 16 horas para considerar una entrada como activa
        if (diff.inHours < 16) {
          return 'entrada';
        }
      }
    }
    return 'salida';
  }

  Future<void> _checkPendingCount() async {
    final count = await SyncService.getPendingCount();
    if (mounted) {
      setState(() {
        _pendingSyncCount = count;
      });
    }
  }

  Future<void> _triggerSync() async {
    if (_isSyncingNow) return;
    setState(() => _isSyncingNow = true);
    await SyncService.syncOfflineRecords();
    await SupabaseService.syncEmployeeSchedule();
    _loadSettings();
    await _checkPendingCount();
    if (mounted) {
      setState(() => _isSyncingNow = false);
    }
  }

  void _openScanner(String tipoRegistro) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ScannerScreen(
          isLinking: false,
          tipoRegistro: tipoRegistro,
        ),
      ),
    ).then((_) {
      _checkPendingCount();
      // Forzar intento de sincronización inmediata si hay red
      _triggerSync();
    });
  }

  Future<void> _unlink() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Confirmar desvinculación', style: TextStyle(color: Colors.white)),
        content: const Text(
          '¿Estás seguro de que deseas desvincular este dispositivo? Perderás las notificaciones de horario configuradas.',
          style: TextStyle(color: Color(0xFF94A3B8)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar', style: TextStyle(color: Color(0xFF64748B))),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: TextButton.styleFrom(foregroundColor: Colors.redAccent),
            child: const Text('Desvincular'),
          ),
        ],
      ),
    );

    if (confirm == true) {
      await SupabaseService.unlinkDevice();
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const LinkingScreen()),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    String todayStr;
    try {
      todayStr = DateFormat('EEEE, d \'de\' MMMM', 'es_ES').format(DateTime.now());
      todayStr = todayStr[0].toUpperCase() + todayStr.substring(1);
    } catch (e) {
      todayStr = DateFormat('yyyy-MM-dd').format(DateTime.now());
    }

    final String nextAction = _getCurrentRegistrationType();
    final bool isInside = nextAction == 'entrada';

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A), // Slate 900
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.sync_rounded, color: Color(0xFF38BDF8)),
            onPressed: _triggerSync,
            tooltip: 'Sincronizar ahora',
          ),
          IconButton(
            icon: const Icon(Icons.logout_rounded, color: Color(0xFFFDA4AF)),
            onPressed: _unlink,
            tooltip: 'Desvincular celular',
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Bienvenida y Nombre de Empleado
            Text(
              todayStr,
              style: const TextStyle(color: Color(0xFF64748B), fontSize: 14, fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 8),
            Text(
              '¡Hola, $_employeeName!',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 32,
                fontWeight: FontWeight.bold,
                letterSpacing: -0.5,
              ),
            ),
            const SizedBox(height: 16),
            
            // Estado de Sincronización Minimalista
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFF1E293B),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFF334155)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    _pendingSyncCount > 0 ? Icons.sync_problem_rounded : Icons.cloud_done_rounded,
                    color: _pendingSyncCount > 0 ? const Color(0xFFF59E0B) : const Color(0xFF10B981),
                    size: 16,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _pendingSyncCount > 0
                          ? '$_pendingSyncCount marcados pendientes por sincronizar'
                          : 'Todos los datos sincronizados',
                      style: TextStyle(
                        color: _pendingSyncCount > 0 ? const Color(0xFFF59E0B) : const Color(0xFF10B981),
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            
            const Spacer(),

            // Estado actual del empleado
            Center(
              child: Text(
                isInside ? 'JORNADA ACTIVA (DENTRO)' : 'JORNADA INACTIVA (FUERA)',
                style: TextStyle(
                  color: isInside ? const Color(0xFF38BDF8) : const Color(0xFF64748B),
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 2.0,
                ),
              ),
            ),
            const SizedBox(height: 16),

            // BOTÓN DE MARCADO ÚNICO DINÁMICO
            InkWell(
              onTap: () => _openScanner(isInside ? 'salida' : 'entrada'),
              borderRadius: BorderRadius.circular(28),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 40),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: isInside
                        ? [const Color(0xFFEF4444), const Color(0xFFDC2626)] // Red 500 a 600
                        : [const Color(0xFF10B981), const Color(0xFF059669)], // Emerald 500 a 600
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(28),
                  boxShadow: [
                    BoxShadow(
                      color: (isInside ? const Color(0xFFEF4444) : const Color(0xFF10B981)).withOpacity(0.3),
                      blurRadius: 20,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    Icon(
                      isInside ? Icons.logout_rounded : Icons.login_rounded,
                      color: Colors.white,
                      size: 56,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      isInside ? 'REGISTRAR SALIDA' : 'REGISTRAR ENTRADA',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.0,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            
            const Spacer(flex: 2),
          ],
        ),
      ),
    );
  }
}
