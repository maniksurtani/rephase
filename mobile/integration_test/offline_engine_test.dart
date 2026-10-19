import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:rephase/engine/bundled_mobile_engine.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('bundled native runtime plans offline and resolves DST safely', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: Text('Offline engine check'))),
    );
    await tester.runAsync(() async {
      final engine = BundledMobileEngine();
      try {
        final bootstrap = await engine.call('bootstrap');
        final airports = bootstrap['airports'] as List;
        expect(
          airports.cast<Map>().singleWhere(
            (airport) => airport['code'] == 'SFO',
          )['city'],
          'San Francisco',
        );
        final preferences = Map<String, dynamic>.from(
          bootstrap['defaultPreferences'] as Map,
        );
        expect(preferences['planningMode'], 'model');
        final trip = Map<String, dynamic>.from(bootstrap['demoTrip'] as Map);
        final now = DateTime.now().millisecondsSinceEpoch;
        final result = await engine.call('plan', {
          'trip': trip,
          'preferences': preferences,
          'now': now,
        });
        final days = (result['days'] as List).cast<Map>();
        final plan = Map<String, dynamic>.from(result['plan'] as Map);
        expect(plan['model'], containsPair('numericallyVerified', true));
        expect(days, isNotEmpty);
        expect(days.map((day) => day['date']).toSet().length, days.length);
        expect(result['loungeContexts'], hasLength(4));
        expect(
          days.every((day) => day['steps'] is List && day['lastClock'] is Map),
          isTrue,
        );
        final refreshed = await engine.call('view', {
          'plan': result['plan'],
          'trip': trip,
          'now': now + 60000,
        });
        expect(refreshed['plan'], result['plan']);

        final gap = await engine.call('localTime', {
          'dateTime': '2026-03-08T02:30',
          'timeZone': 'America/New_York',
        });
        expect(gap['valid'], isFalse);
        final fold = await engine.call('localTime', {
          'dateTime': '2026-11-01T01:30',
          'timeZone': 'America/New_York',
        });
        expect(fold['ambiguous'], isTrue);
        final later = await engine.call('localTime', {
          'dateTime': '2026-11-01T01:30',
          'timeZone': 'America/New_York',
          'disambiguation': 'later',
        });
        final clock = await engine.call('clock', {
          'instant': later['iso'],
          'timeZone': 'America/New_York',
        });
        expect(clock['localDateTime'], '2026-11-01T01:30');
        expect(clock['choice'], 'later');
      } finally {
        await engine.dispose();
      }
    });
  }, timeout: const Timeout(Duration(minutes: 2)));
}
