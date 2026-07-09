import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tz;
import 'package:timezone/timezone.dart' as tz;
import 'package:flutter_timezone/flutter_timezone.dart';

class NotificationService {
  static final FlutterLocalNotificationsPlugin _notificationsPlugin =
      FlutterLocalNotificationsPlugin();

  static bool _initialized = false;

  static Future<void> init() async {
    try {
      // Inicializar Zonas Horarias
      tz.initializeTimeZones();
      final String timeZoneName = await FlutterTimezone.getLocalTimezone();
      tz.setLocalLocation(tz.getLocation(timeZoneName));

      const AndroidInitializationSettings initializationSettingsAndroid =
          AndroidInitializationSettings('@mipmap/ic_launcher');

      const DarwinInitializationSettings initializationSettingsIOS =
          DarwinInitializationSettings(
        requestAlertPermission: true,
        requestBadgePermission: true,
        requestSoundPermission: true,
      );

      const InitializationSettings initializationSettings = InitializationSettings(
        android: initializationSettingsAndroid,
        iOS: initializationSettingsIOS,
      );

      await _notificationsPlugin.initialize(
        initializationSettings,
        onDidReceiveNotificationResponse: (details) {
          // Manejar click en notificación si es necesario
        },
      );

      _initialized = true;
    } catch (e) {
      // Si las notificaciones fallan al inicializarse, no debe crashear la app.
      // La app seguirá funcionando sin notificaciones programadas.
      _initialized = false;
    }
  }

  // Cancelar todas las notificaciones
  static Future<void> cancelAllNotifications() async {
    if (!_initialized) return;
    try {
      await _notificationsPlugin.cancelAll();
    } catch (e) {
      // Ignorar errores al cancelar
    }
  }

  // Cancelar una notificación específica (ej. al marcar asistencia cancelamos la alerta de retraso)
  static Future<void> cancelNotification(int id) async {
    if (!_initialized) return;
    try {
      await _notificationsPlugin.cancel(id);
    } catch (e) {
      // Ignorar errores al cancelar
    }
  }

  // Programar alertas diarias basadas en el horario de entrada del empleado
  static Future<void> scheduleAttendanceReminders({
    required String empleadoNombre,
    required String horaEntradaStr, // Formato "HH:mm:ss" o "HH:mm"
    required List<int> diasLaborales, // 1 = Lunes, 7 = Domingo (ISO)
  }) async {
    if (!_initialized) return;

    try {
      await cancelAllNotifications();

      final parts = horaEntradaStr.split(':');
      final int entradaHour = int.parse(parts[0]);
      final int entradaMinute = int.parse(parts[1]);

      // 1. Alerta Previa (15 minutos antes de la hora de entrada)
      final entradaTime = DateTime(2026, 1, 1, entradaHour, entradaMinute);
      final alertaPreviaTime = entradaTime.subtract(const Duration(minutes: 15));

      // 2. Alerta Posterior (10 minutos después si no ha registrado)
      final alertaPosteriorTime = entradaTime.add(const Duration(minutes: 10));

      // Programar para cada día de la semana laboral
      for (int dia in diasLaborales) {
        // Programar Alerta Previa (ID impar, ej: dia * 2)
        await _scheduleWeeklyNotification(
          id: dia * 2,
          title: 'Recordatorio de Entrada',
          body: 'Hola $empleadoNombre, quedan 15 minutos para registrar tu entrada.',
          dayOfWeek: dia,
          hour: alertaPreviaTime.hour,
          minute: alertaPreviaTime.minute,
        );

        // Programar Alerta Posterior (ID par, ej: dia * 2 + 1)
        await _scheduleWeeklyNotification(
          id: dia * 2 + 1,
          title: 'Alerta de Asistencia',
          body: '¿Ya estás en tu puesto? Aún no has registrado tu entrada del día de hoy.',
          dayOfWeek: dia,
          hour: alertaPosteriorTime.hour,
          minute: alertaPosteriorTime.minute,
        );
      }
    } catch (e) {
      // Si falla la programación de notificaciones, no afectar el flujo principal
    }
  }

  // Programación semanal de notificaciones locales
  static Future<void> _scheduleWeeklyNotification({
    required int id,
    required String title,
    required String body,
    required int dayOfWeek,
    required int hour,
    required int minute,
  }) async {
    try {
      final tz.TZDateTime scheduledDate = _nextInstanceOfTime(dayOfWeek, hour, minute);

      await _notificationsPlugin.zonedSchedule(
        id,
        title,
        body,
        scheduledDate,
        const NotificationDetails(
          android: AndroidNotificationDetails(
            'asistencia_reminders',
            'Recordatorios de Asistencia',
            channelDescription: 'Canal para alertas de horarios de entrada y salida',
            importance: Importance.max,
            priority: Priority.high,
          ),
          iOS: DarwinNotificationDetails(
            presentAlert: true,
            presentBadge: true,
            presentSound: true,
          ),
        ),
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        uiLocalNotificationDateInterpretation:
            UILocalNotificationDateInterpretation.absoluteTime,
        matchDateTimeComponents: DateTimeComponents.dayOfWeekAndTime,
      );
    } catch (e) {
      // Si una notificación individual falla, continuar con las demás
    }
  }

  // Calcular la próxima ocurrencia de un día de la semana a una hora específica
  static tz.TZDateTime _nextInstanceOfTime(int dayOfWeek, int hour, int minute) {
    tz.TZDateTime scheduledDate = tz.TZDateTime.now(tz.local);
    scheduledDate = tz.TZDateTime(
      tz.local,
      scheduledDate.year,
      scheduledDate.month,
      scheduledDate.day,
      hour,
      minute,
    );

    // Ajustar si la hora ya pasó hoy
    if (scheduledDate.isBefore(tz.TZDateTime.now(tz.local))) {
      scheduledDate = scheduledDate.add(const Duration(days: 1));
    }

    // Ajustar hasta llegar al día de la semana correspondiente (1: Lunes, 7: Domingo)
    while (scheduledDate.weekday != dayOfWeek) {
      scheduledDate = scheduledDate.add(const Duration(days: 1));
    }

    return scheduledDate;
  }
}
