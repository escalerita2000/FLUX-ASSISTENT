import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'dart:convert';
import 'package:geolocator/geolocator.dart';
import '../services/gps_service.dart';
import '../services/sync_service.dart';
import 'package:hive/hive.dart';

class ScannerScreen extends StatefulWidget {
  final bool isLinking;
  final String? tipoRegistro; // 'entrada' o 'salida'

  const ScannerScreen({
    super.key,
    required this.isLinking,
    this.tipoRegistro,
  });

  @override
  State<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<ScannerScreen> {
  final MobileScannerController _cameraController = MobileScannerController();
  bool _isProcessing = false;
  String? _statusMessage;
  bool _showResultOverlay = false;
  bool _registrationSuccess = false;
  String _resultTitle = '';
  String _resultBody = '';

  @override
  void dispose() {
    _cameraController.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) async {
    if (_isProcessing) return;

    final List<Barcode> barcodes = capture.barcodes;
    if (barcodes.isEmpty) return;

    final String? codeValue = barcodes.first.rawValue;
    if (codeValue == null) return;

    setState(() {
      _isProcessing = true;
    });

    if (widget.isLinking) {
      // Si estamos en fase de vinculación, simplemente devolvemos el código escaneado
      Navigator.of(context).pop(codeValue);
      return;
    }

    // Flujo de Marcado de Asistencia
    await _processAttendanceScan(codeValue);
  }

  Future<void> _processAttendanceScan(String qrData) async {
    double? qrLat;
    double? qrLng;
    String? locationId;
    String locationName = 'Punto Físico';
    double geoFenceThreshold = 15.0;
    double distanceInMeters = 0.0;
    bool isGpsValid = false;

    // 1. Obtener Ubicación GPS del Dispositivo
    setState(() {
      _statusMessage = 'Obteniendo ubicación GPS...';
    });

    Position? currentPos;
    try {
      currentPos = await GpsService.getCurrentLocation();
    } catch (e) {
      _showResult(
        success: false,
        title: 'Error de Localización',
        body: 'No pudimos obtener tu ubicación actual. Verifica los permisos de GPS. Detalles: $e',
      );
      return;
    }

    if (currentPos == null) {
      _showResult(
        success: false,
        title: 'Ubicación Inalcanzable',
        body: 'No fue posible obtener coordenadas GPS estables en este momento.',
      );
      return;
    }

    // 2. Decodificar Datos del QR y validar zona
    try {
      final Map<String, dynamic> data = jsonDecode(qrData);

      // Caso A: QR Único Global
      if (data['type'] == 'attendance_global') {
        final box = await Hive.openBox('puntos_asistencia');
        final List<dynamic> points = box.values.toList();

        if (points.isEmpty) {
          _showResult(
            success: false,
            title: 'Sin Oficinas',
            body: 'No hay oficinas registradas en el celular. Conéctate a internet para sincronizar.',
          );
          return;
        }

        double minDistance = double.infinity;
        Map<String, dynamic>? closestPoint;

        for (var p in points) {
          final Map<String, dynamic> punto = Map<String, dynamic>.from(p as Map);
          final double dist = GpsService.calculateDistance(
            currentPos.latitude,
            currentPos.longitude,
            (punto['latitud'] as num).toDouble(),
            (punto['longitud'] as num).toDouble(),
          );
          if (dist < minDistance) {
            minDistance = dist;
            closestPoint = punto;
          }
        }

        if (closestPoint == null) {
          _showResult(
            success: false,
            title: 'Error',
            body: 'No se pudo determinar la oficina más cercana.',
          );
          return;
        }

        locationId = closestPoint['id']?.toString();
        locationName = closestPoint['nombre']?.toString() ?? 'Punto Físico';
        qrLat = (closestPoint['latitud'] as num).toDouble();
        qrLng = (closestPoint['longitud'] as num).toDouble();
        geoFenceThreshold = (closestPoint['radio_metros'] as num).toDouble();
        distanceInMeters = minDistance;
        isGpsValid = distanceInMeters <= geoFenceThreshold;
      } 
      // Caso B: QR Específico (retrocompatibilidad)
      else {
        qrLat = (data['lat'] as num).toDouble();
        qrLng = (data['lng'] as num).toDouble();
        locationId = data['location_id']?.toString();
        locationName = data['location_name']?.toString() ?? 'Punto Físico';
        geoFenceThreshold = (data['radio_metros'] as num?)?.toDouble() ?? 15.0;

        distanceInMeters = GpsService.calculateDistance(
          currentPos.latitude,
          currentPos.longitude,
          qrLat!,
          qrLng!,
        );
        isGpsValid = distanceInMeters <= geoFenceThreshold;
      }
    } catch (e) {
      _showResult(
        success: false,
        title: 'Código QR Inválido',
        body: 'El código QR escaneado no pertenece a un punto de asistencia válido.',
      );
      return;
    }

    // 3. Validar zona de asistencia (mensaje de estado)
    setState(() {
      _statusMessage = 'Validando zona de asistencia...';
    });

    // 4. Guardar Registro Localmente (Offline-First)
    setState(() {
      _statusMessage = 'Guardando registro localmente...';
    });

    final DateTime now = DateTime.now();

    await SyncService.saveRecordOffline(
      puntoId: locationId,
      fechaHoraDispositivo: now,
      latitud: currentPos.latitude,
      longitud: currentPos.longitude,
      tipoRegistro: widget.tipoRegistro!,
      gpsValid: isGpsValid,
    );

    // 5. Mostrar Resultados Visuales
    if (isGpsValid) {
      _showResult(
        success: true,
        title: widget.tipoRegistro == 'entrada' ? '¡Entrada Registrada!' : '¡Salida Registrada!',
        body: 'Guardado a las ${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')} en $locationName.',
      );
    } else {
      _showResult(
        success: true,
        title: 'Registro Fuera de Zona',
        body: 'Guardado con advertencia. Estás a ${distanceInMeters.round()} metros de $locationName. El administrador será notificado.',
        isWarning: true,
      );
    }
  }

  void _showResult({
    required bool success,
    required String title,
    required String body,
    bool isWarning = false,
  }) {
    setState(() {
      _showResultOverlay = true;
      _registrationSuccess = success;
      _resultTitle = title;
      _resultBody = body;
    });

    // Auto regresar después de 4 segundos
    Future.delayed(const Duration(seconds: 4), () {
      if (mounted) {
        Navigator.of(context).pop();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final bool isEntry = widget.tipoRegistro == 'entrada';
    final Color actionColor = widget.isLinking
        ? const Color(0xFF6366F1) // Indigo
        : (isEntry ? const Color(0xFF10B981) : const Color(0xFFEF4444)); // Verde o Rojo

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // Lector de Cámara QR
          if (!_showResultOverlay)
            MobileScanner(
              controller: _cameraController,
              onDetect: _onDetect,
              errorBuilder: (context, error, child) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.error_outline_rounded,
                          color: Colors.redAccent,
                          size: 48,
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'Error de cámara:\n${error.errorCode.name}\n${error.errorDetails?.message ?? ""}',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),

          // Interfaz Guía de Escaneo
          if (!_showResultOverlay)
            SafeArea(
              child: Column(
                children: [
                  // App Bar Transparente con botón de regreso
                  Padding(
                    padding: const EdgeInsets.all(8.0),
                    child: Align(
                      alignment: Alignment.topLeft,
                      child: IconButton(
                        icon: const Icon(Icons.arrow_back_rounded, color: Colors.white, size: 28),
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                    ),
                  ),
                  const Spacer(),
                  // Cuadro Guía de Escaneo
                  Container(
                    width: 250,
                    height: 250,
                    decoration: BoxDecoration(
                      border: Border.all(color: actionColor, width: 4),
                      borderRadius: BorderRadius.circular(24),
                    ),
                  ),
                  const SizedBox(height: 24),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    decoration: BoxDecoration(
                      color: Colors.black.withOpacity(0.6),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      widget.isLinking
                          ? 'Escanea el QR de vinculación'
                          : 'Apunta al código QR de ${widget.tipoRegistro!.toUpperCase()}',
                      style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                  ),
                  const Spacer(),
                  // Mensaje de estado (Ej: Obteniendo GPS...)
                  if (_isProcessing && _statusMessage != null)
                    Container(
                      margin: const EdgeInsets.only(bottom: 48),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.8),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                          ),
                          const SizedBox(width: 16),
                          Text(
                            _statusMessage!,
                            style: const TextStyle(color: Colors.white, fontSize: 14),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),

          // Pantalla de Resultado (Overlay Pantalla Completa Verde / Rojo / Advertencia)
          if (_showResultOverlay)
            _buildResultOverlay(isEntry),
        ],
      ),
    );
  }

  Widget _buildResultOverlay(bool isEntry) {
    // Si no fue exitoso el marcado, fondo gris/rojo
    Color overlayBgColor = const Color(0xFF1E293B); // Por defecto gris
    IconData resultIcon = Icons.error_outline_rounded;

    if (_registrationSuccess) {
      if (_resultTitle == 'Registro Fuera de Zona') {
        overlayBgColor = const Color(0xFFD97706); // Naranja Amber
        resultIcon = Icons.warning_amber_rounded;
      } else {
        overlayBgColor = isEntry ? const Color(0xFF059669) : const Color(0xFFDC2626); // Verde o Rojo
        resultIcon = Icons.check_circle_outline_rounded;
      }
    }

    return Container(
      color: overlayBgColor,
      width: double.infinity,
      height: double.infinity,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                resultIcon,
                size: 120,
                color: Colors.white,
              ),
              const SizedBox(height: 32),
              Text(
                _resultTitle,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 32,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                _resultBody,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 18,
                ),
              ),
              const SizedBox(height: 48),
              ElevatedButton(
                onPressed: () => Navigator.of(context).pop(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: overlayBgColor,
                  padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                child: const Text(
                  'Entendido',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
