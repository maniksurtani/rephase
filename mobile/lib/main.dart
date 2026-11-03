import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'app_controller.dart';
import 'engine/bundled_mobile_engine.dart';
import 'rephase_app.dart';
import 'notifications/reminder_gateway.dart';
import 'notifications/trip_reminders.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  LicenseRegistry.addLicense(() async* {
    yield LicenseEntryWithLineBreaks(const [
      'Rephase offline planning and data',
    ], await rootBundle.loadString('assets/engine/NOTICE.txt'));
  });
  final controller = AppController(engine: BundledMobileEngine());
  runApp(
    RephaseApp(
      controller: controller,
      reminders: TripReminders(
        gateway: LocalReminderGateway(),
        settings: DeviceReminderSettings(),
        plan: controller.planForReminders,
      ),
    ),
  );
}
