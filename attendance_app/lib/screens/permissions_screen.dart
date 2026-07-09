import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:permission_handler/permission_handler.dart';
import 'dart:io';

class PermissionsScreen extends StatefulWidget {
  final Widget destination;

  const PermissionsScreen({super.key, required this.destination});

  @override
  State<PermissionsScreen> createState() => _PermissionsScreenState();
}

class _PermissionsScreenState extends State<PermissionsScreen>
    with SingleTickerProviderStateMixin {
  bool _locationGranted = false;
  bool _notificationGranted = false;
  bool _cameraGranted = false;
  bool _checkingPermissions = true;
  late AnimationController _animController;
  late Animation<double> _fadeAnim;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _fadeAnim = CurvedAnimation(parent: _animController, curve: Curves.easeOut);
    _animController.forward();
    _checkAllPermissions();
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  Future<void> _checkAllPermissions() async {
    setState(() => _checkingPermissions = true);

    // 1. Verificar ubicación
    final locPerm = await Geolocator.checkPermission();
    _locationGranted = locPerm == LocationPermission.always ||
        locPerm == LocationPermission.whileInUse;

    // 2. Verificar cámara
    final camStatus = await Permission.camera.status;
    _cameraGranted = camStatus.isGranted;

    // 3. Verificar notificaciones
    if (Platform.isAndroid) {
      final FlutterLocalNotificationsPlugin plugin =
          FlutterLocalNotificationsPlugin();
      final androidPlugin =
          plugin.resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();
      if (androidPlugin != null) {
        final bool? granted = await androidPlugin.areNotificationsEnabled();
        _notificationGranted = granted ?? false;
      } else {
        _notificationGranted = true;
      }
    } else {
      _notificationGranted = true;
    }

    if (mounted) {
      setState(() => _checkingPermissions = false);
    }

    // Si todos los permisos están concedidos, avanzar automáticamente
    if (_locationGranted && _notificationGranted && _cameraGranted) {
      _proceedToApp();
    }
  }

  Future<void> _requestLocation() async {
    LocationPermission permission = await Geolocator.checkPermission();

    if (permission == LocationPermission.deniedForever) {
      await Geolocator.openAppSettings();
      return;
    }

    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    setState(() {
      _locationGranted = permission == LocationPermission.always ||
          permission == LocationPermission.whileInUse;
    });

    _checkIfAllGranted();
  }

  Future<void> _requestCamera() async {
    final status = await Permission.camera.status;
    if (status.isPermanentlyDenied) {
      await openAppSettings();
      return;
    }
    final reqStatus = await Permission.camera.request();
    setState(() {
      _cameraGranted = reqStatus.isGranted;
    });

    _checkIfAllGranted();
  }

  Future<void> _requestNotifications() async {
    if (Platform.isAndroid) {
      final FlutterLocalNotificationsPlugin plugin =
          FlutterLocalNotificationsPlugin();
      final androidPlugin =
          plugin.resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();
      if (androidPlugin != null) {
        final bool? granted =
            await androidPlugin.requestNotificationsPermission();
        setState(() {
          _notificationGranted = granted ?? false;
        });
      }
    }

    _checkIfAllGranted();
  }

  void _checkIfAllGranted() {
    if (_locationGranted && _notificationGranted && _cameraGranted) {
      _proceedToApp();
    }
  }

  void _proceedToApp() {
    Future.delayed(const Duration(milliseconds: 300), () {
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => widget.destination),
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      body: SafeArea(
        child: FadeTransition(
          opacity: _fadeAnim,
          child: Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 24.0, vertical: 32.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Spacer(),
                // Icono principal
                const Icon(
                  Icons.security_rounded,
                  size: 72,
                  color: Color(0xFF6366F1),
                ),
                const SizedBox(height: 24),
                const Text(
                  'Permisos Necesarios',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Para funcionar correctamente, la app necesita los siguientes permisos.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Color(0xFF94A3B8),
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 32),

                if (_checkingPermissions)
                  const Center(
                    child: CircularProgressIndicator(
                      color: Color(0xFF6366F1),
                    ),
                  )
                else ...[
                  // Permiso de Cámara
                  _buildPermissionCard(
                    icon: Icons.camera_alt_rounded,
                    title: 'Cámara',
                    description:
                        'Necesaria para escanear el código QR.',
                    granted: _cameraGranted,
                    onRequest: _requestCamera,
                  ),
                  const SizedBox(height: 14),

                  // Permiso de Ubicación
                  _buildPermissionCard(
                    icon: Icons.location_on_rounded,
                    title: 'Ubicación',
                    description:
                        'Necesaria para validar que estés en tu punto de asistencia.',
                    granted: _locationGranted,
                    onRequest: _requestLocation,
                  ),
                  const SizedBox(height: 14),

                  // Permiso de Notificaciones
                  _buildPermissionCard(
                    icon: Icons.notifications_active_rounded,
                    title: 'Notificaciones',
                    description:
                        'Para recordarte tu hora de entrada y salida.',
                    granted: _notificationGranted,
                    onRequest: _requestNotifications,
                  ),
                  const SizedBox(height: 32),

                  // Botón continuar (solo si TODOS concedidos)
                  if (_locationGranted && _notificationGranted && _cameraGranted)
                    ElevatedButton(
                      onPressed: _proceedToApp,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF6366F1),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        elevation: 0,
                      ),
                      child: const Text(
                        'Continuar',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                    ),
                ],

                const Spacer(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPermissionCard({
    required IconData icon,
    required String title,
    required String description,
    required bool granted,
    required VoidCallback onRequest,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: granted ? const Color(0xFF10B981) : const Color(0xFF334155),
          width: granted ? 2 : 1,
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: granted
                  ? const Color(0xFF10B981).withOpacity(0.15)
                  : const Color(0xFF6366F1).withOpacity(0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              icon,
              color: granted ? const Color(0xFF10B981) : const Color(0xFF6366F1),
              size: 24,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  description,
                  style: const TextStyle(
                    color: Color(0xFF94A3B8),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          if (granted)
            const Icon(Icons.check_circle_rounded,
                color: Color(0xFF10B981), size: 26)
          else
            TextButton(
              onPressed: onRequest,
              style: TextButton.styleFrom(
                foregroundColor: const Color(0xFF6366F1),
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                  side: const BorderSide(color: Color(0xFF6366F1)),
                ),
              ),
              child: const Text(
                'Permitir',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }
}
