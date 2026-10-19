import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rephase/app_controller.dart';
import 'package:rephase/data/local_repository.dart';
import 'package:rephase/data/mobile_api.dart';
import 'package:rephase/data/models.dart';
import 'package:rephase/data/session_store.dart';
import 'package:rephase/engine/mobile_engine.dart';
import 'package:rephase/rephase_app.dart';

const _preferences = <String, dynamic>{
  'homeTimeZone': 'Pacific/Honolulu',
  'chronotype': 'intermediate',
  'usualBedtime': '23:00',
  'usualWakeTime': '07:00',
  'preferredBedtime': '23:00',
  'preferredWakeTime': '07:00',
  'sleepHours': 8,
  'sleepAnchor': 'wake',
  'caffeine': true,
  'melatonin': false,
  'melatoninAcknowledged': false,
  'preparationDays': 3,
};

class _Engine implements MobileEngine {
  final operations = <String>[];
  @override
  Future<Json> call(String operation, [Json payload = const {}]) async {
    operations.add(operation);
    switch (operation) {
      case 'bootstrap':
        return {
          'defaultPreferences': _preferences,
          'airports': [
            {
              'code': 'SFO',
              'city': 'San Francisco',
              'name': 'San Francisco International Airport',
              'timeZone': 'America/Los_Angeles',
            },
          ],
          'timeZones': ['Pacific/Honolulu', 'America/Los_Angeles'],
          'loyaltyPrograms': [],
          'memberships': [],
          'loungeAirports': [
            {'airport': 'SFO'},
          ],
          'airlines': [],
        };
      case 'loungeVisit':
        return {
          'airport': payload['airport'],
          'timeZone': 'America/Los_Angeles',
          'date': '2026-10-18',
          'from': '10:00',
          'until': '12:00',
          'departureTime': '13:00',
          'cabin': 'economy',
          'route': 'international',
          'terminals': [],
          'airportData': {'airport': 'SFO', 'lounges': []},
        };
      case 'lounges':
        return {
          'timeZone': 'America/Los_Angeles',
          'airportData': {'airport': 'SFO', 'lounges': []},
          'results': [],
          'recommendedId': null,
        };
      case 'newTrip':
        return {
          'trip': {
            'id': 'new-trip',
            'name': 'My next journey',
            'createdAt': '2026-10-18T23:00:00Z',
            'updatedAt': '2026-10-18T23:00:00Z',
            'legs': [
              {
                'id': 'new-leg',
                'flightNumber': '',
                'departureAirport': '',
                'arrivalAirport': '',
                'departureDateTime': '',
                'arrivalDateTime': '',
                'departureTimeZone': 'America/Los_Angeles',
                'arrivalTimeZone': 'Europe/London',
                'stayAfter': 'destination',
                'strategy': 'adapt',
                'travelClass': 'economy',
                'lieFlat': false,
              },
            ],
          },
        };
      default:
        throw StateError('Unexpected engine operation $operation');
    }
  }

  @override
  Future<void> dispose() async {}
}

class _Repository implements LocalRepository {
  @override
  Future<CachedState?> read(String? accountId) async => null;
  @override
  Future<void> write(String? accountId, CachedState state) async {}
  @override
  Future<void> clear(String? accountId) async {}
}

class _Sessions implements SessionStore {
  @override
  Future<AccountSession?> read() async => null;
  @override
  Future<void> write(AccountSession? session) async {}
}

class _Identity implements GoogleIdentity {
  int authenticationCalls = 0;
  @override
  Future<String?> authenticate({
    required String serverClientId,
    String? clientId,
  }) async {
    authenticationCalls++;
    throw StateError('Google sign-in must require an explicit tap.');
  }

  @override
  Future<void> signOut() async {}
}

class _Api implements MobileApi {
  final operations = <String>[];
  @override
  Future<Json> config() async {
    operations.add('config');
    return {'googleClientId': 'test-only-client'};
  }

  @override
  void close() {}

  @override
  dynamic noSuchMethod(Invocation invocation) => throw StateError(
    'Unexpected account/provider call: ${invocation.memberName}',
  );
}

void main() {
  testWidgets(
    'fresh guest can navigate the app and discard a trip draft without signing in',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 1.6;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final engine = _Engine();
      final identity = _Identity();
      final api = _Api();
      final controller = AppController(
        engine: engine,
        repository: _Repository(),
        api: api,
        sessionStore: _Sessions(),
        identity: identity,
        clock: () => DateTime.utc(2026, 10, 18, 23, 13),
      );
      // RephaseApp owns this controller and disposes its timer and API client.
      await tester.pumpWidget(RephaseApp(controller: controller));
      await tester.pumpAndSettle();
      expect(find.text('Arrive in rhythm.'), findsOneWidget);
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(identity.authenticationCalls, 0);
      expect(tester.takeException(), isNull);

      Future<void> navigate(String title) async {
        await tester.tap(
          find.descendant(
            of: find.byType(NavigationBar),
            matching: find.text(title),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }

      await navigate('Profile');
      expect(find.text('Your settings'), findsOneWidget);
      expect(find.text('Continue with Google'), findsOneWidget);
      await navigate('Lounges');
      expect(find.text('Lounge Explorer'), findsOneWidget);
      expect(engine.operations, containsAll(['loungeVisit', 'lounges']));
      await navigate('Your plan');
      expect(find.text('Arrive in rhythm.'), findsOneWidget);
      await navigate('Trips');
      expect(find.text('Your trips'), findsOneWidget);
      await tester.tap(find.text('New trip'));
      await tester.pumpAndSettle();
      expect(find.text('Trip name'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Trip name'),
        'Unsaved Hawaii trip',
      );
      await tester.tap(find.byTooltip('Close trip editor'));
      await tester.pumpAndSettle();
      expect(find.text('Discard changes?'), findsOneWidget);
      await tester.tap(find.text('Discard'));
      await tester.pumpAndSettle();
      expect(find.text('Your trips'), findsOneWidget);
      expect(controller.trips, isEmpty);
      expect(identity.authenticationCalls, 0);
      expect(api.operations, ['config']);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
}
