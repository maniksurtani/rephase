import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/timezone.dart' as tz;

import 'trip_reminder.dart';

abstract interface class ReminderGateway {
  Future<void> initialize(void Function(String?) onTap);
  Future<bool> allowed();
  Future<bool> requestPermission();
  Future<List<PendingNotificationRequest>> pending();
  Future<void> schedule(int id, TripReminder reminder);
  Future<void> cancel(int id);
  Future<void> cancelAll();
  Future<void> test();
}

abstract interface class ReminderSettingsStore {
  Future<bool> enabled(String owner);
  Future<void> setEnabled(String owner, bool enabled);
}

class DeviceReminderSettings implements ReminderSettingsStore {
  final _preferences = SharedPreferencesAsync();
  @override
  Future<bool> enabled(String owner) async =>
      await _preferences.getBool('reminders.enabled.$owner') ?? false;
  @override
  Future<void> setEnabled(String owner, bool enabled) =>
      _preferences.setBool('reminders.enabled.$owner', enabled);
}

class LocalReminderGateway implements ReminderGateway {
  final _plugin = FlutterLocalNotificationsPlugin();
  static const _details = NotificationDetails(
    android: AndroidNotificationDetails(
      'trip_guidance',
      'Trip reminders',
      channelDescription:
          'Sleep, light and optional caffeine or melatonin guidance.',
      importance: Importance.defaultImportance,
      priority: Priority.defaultPriority,
      visibility: NotificationVisibility.private,
    ),
    iOS: DarwinNotificationDetails(presentAlert: true, presentSound: true),
  );

  AndroidFlutterLocalNotificationsPlugin? get _android => _plugin
      .resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin
      >();
  IOSFlutterLocalNotificationsPlugin? get _ios => _plugin
      .resolvePlatformSpecificImplementation<
        IOSFlutterLocalNotificationsPlugin
      >();

  @override
  Future<void> initialize(void Function(String?) onTap) async {
    await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('ic_notification'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
      onDidReceiveNotificationResponse: (response) => onTap(response.payload),
    );
    final launch = await _plugin.getNotificationAppLaunchDetails();
    if (launch?.didNotificationLaunchApp == true) {
      onTap(launch!.notificationResponse?.payload);
    }
  }

  @override
  Future<bool> allowed() async => _android != null
      ? await _android!.areNotificationsEnabled() ?? false
      : (await _ios?.checkPermissions())?.isEnabled ?? false;
  @override
  Future<bool> requestPermission() async => _android != null
      ? await _android!.requestNotificationsPermission() ?? false
      : await _ios?.requestPermissions(
              alert: true,
              sound: true,
              badge: false,
            ) ??
            false;
  @override
  Future<List<PendingNotificationRequest>> pending() =>
      _plugin.pendingNotificationRequests();
  @override
  Future<void> schedule(int id, TripReminder reminder) => _plugin.zonedSchedule(
    id: id,
    title: reminder.title,
    body: reminder.body,
    scheduledDate: tz.TZDateTime.from(reminder.at, tz.UTC),
    notificationDetails: _details,
    androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
    payload: reminder.payload,
  );
  @override
  Future<void> cancel(int id) => _plugin.cancel(id: id);
  @override
  Future<void> cancelAll() => _plugin.cancelAll();
  @override
  Future<void> test() => _plugin.show(
    id: testReminderId,
    title: 'Rephase reminders are ready',
    body:
        'Your saved trips can remind you when it is time for sleep, light and more.',
    notificationDetails: _details,
  );
}
