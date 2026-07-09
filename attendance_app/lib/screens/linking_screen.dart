import 'package:flutter/material.dart';
import '../services/supabase_service.dart';
import 'home_screen.dart';
import 'scanner_screen.dart';

class LinkingScreen extends StatefulWidget {
  const LinkingScreen({super.key});

  @override
  State<LinkingScreen> createState() => _LinkingScreenState();
}

class _LinkingScreenState extends State<LinkingScreen> {
  final TextEditingController _codeController = TextEditingController();
  bool _isLoading = false;
  String? _errorMessage;

  Future<void> _submitCode(String code) async {
    if (code.trim().isEmpty) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final result = await SupabaseService.bindDevice(code.trim());

    setState(() {
      _isLoading = false;
    });

    if (result['success']) {
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const HomeScreen()),
        );
      }
    } else {
      setState(() {
        _errorMessage = result['mensaje'];
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A), // Slate 900 (Fondo Premium)
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 32.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Logo e Icono
              const Icon(
                Icons.qr_code_scanner_rounded,
                size: 72,
                color: Color(0xFF6366F1), // Indigo 500
              ),
              const SizedBox(height: 24),
              const Text(
                'Registro de Asistencia',
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
                'Vincula tu celular para comenzar a registrar tu asistencia.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF94A3B8), // Slate 400
                  fontSize: 15,
                ),
              ),
              const SizedBox(height: 48),

              // Campo de Código Manual
              TextField(
                controller: _codeController,
                style: const TextStyle(color: Colors.white, fontSize: 18),
                decoration: InputDecoration(
                  labelText: 'Código de Vinculación',
                  labelStyle: const TextStyle(color: Color(0xFF64748B)),
                  hintText: 'Ingresa el código proporcionado',
                  hintStyle: const TextStyle(color: Color(0xFF475569)),
                  prefixIcon: const Icon(Icons.key_rounded, color: Color(0xFF6366F1)),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: const BorderSide(color: Color(0xFF334155)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: const BorderSide(color: Color(0xFF6366F1), width: 2),
                  ),
                  filled: true,
                  fillColor: const Color(0xFF1E293B), // Slate 800
                ),
                textCapitalization: TextCapitalization.characters,
              ),
              const SizedBox(height: 16),

              // Botón de Enlace Manual
              ElevatedButton(
                onPressed: _isLoading ? null : () => _submitCode(_codeController.text),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF6366F1),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  elevation: 0,
                ),
                child: _isLoading
                    ? const SizedBox(
                        height: 24,
                        width: 24,
                        child: CircularProgressIndicator(
                          color: Colors.white,
                          strokeWidth: 2.5,
                        ),
                      )
                    : const Text(
                        'Vincular Dispositivo',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
              ),
              const SizedBox(height: 24),

              // Separador Visual
              const Row(
                children: [
                  Expanded(child: Divider(color: Color(0xFF334155))),
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16.0),
                    child: Text('O', style: TextStyle(color: Color(0xFF64748B))),
                  ),
                  Expanded(child: Divider(color: Color(0xFF334155))),
                ],
              ),
              const SizedBox(height: 24),

              // Botón de Escáner QR para Vincular
              OutlinedButton.icon(
                onPressed: _isLoading
                    ? null
                    : () async {
                        final scannedCode = await Navigator.of(context).push<String>(
                          MaterialPageRoute(
                            builder: (_) => const ScannerScreen(isLinking: true),
                          ),
                        );
                        if (scannedCode != null) {
                          _submitCode(scannedCode);
                        }
                      },
                icon: const Icon(Icons.camera_alt_rounded),
                label: const Text('Escanear QR de Activación'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF38BDF8), // Sky 400
                  side: const BorderSide(color: Color(0xFF38BDF8)),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),

              if (_errorMessage != null) ...[
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF7F1D1D), // Rojo oscuro
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFF87171)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.error_outline_rounded, color: Colors.white),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          _errorMessage!,
                          style: const TextStyle(color: Colors.white, fontSize: 14),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
