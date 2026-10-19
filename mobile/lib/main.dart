import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'app_controller.dart';
import 'engine/bundled_mobile_engine.dart';
import 'rephase_app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  LicenseRegistry.addLicense(() async* {
    yield LicenseEntryWithLineBreaks(const [
      'Rephase offline planning and data',
    ], await rootBundle.loadString('assets/engine/NOTICE.txt'));
  });
  runApp(RephaseApp(controller: AppController(engine: BundledMobileEngine())));
}
