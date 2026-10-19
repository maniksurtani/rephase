import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rephase/app_controller.dart';
import 'package:rephase/data/models.dart';
import 'package:rephase/rephase_app.dart';

import 'data_controller_test.dart' as fixtures;

class _LoungeEngine extends fixtures.Engine {
  @override
  Future<Json> call(String operation, [Json payload = const {}]) async {
    switch (operation) {
      case 'bootstrap':
        return {
          ...await super.call(operation, payload),
          'airports': [
            {
              'code': 'SFO',
              'city': 'San Francisco',
              'timeZone': 'America/Los_Angeles',
            },
            {
              'code': 'LAX',
              'city': 'Los Angeles',
              'timeZone': 'America/Los_Angeles',
            },
          ],
          'loungeAirports': [
            {'airport': 'SFO'},
            {'airport': 'LAX'},
          ],
        };
      case 'plan':
      case 'view':
        return {
          'plan': payload['plan'] ?? {'tripId': 'trip-1'},
          'days': [],
          'today': {},
          'loungeContexts': [
            {
              'legId': 'private-leg',
              'airport': 'LAX',
              'flightNumber': 'AA-PRIVATE',
            },
          ],
        };
      case 'loungeVisit':
        return {
          'date': '2026-10-18',
          'from': '10:00',
          'until': '12:00',
          'departureTime': '13:00',
          'airportData': {'airport': payload['airport'], 'lounges': []},
        };
      case 'lounges':
        return {'results': []};
      default:
        return super.call(operation, payload);
    }
  }
}

void main() {
  testWidgets('signing out clears inactive lounge branch flight deep links', (
    tester,
  ) async {
    final repository = fixtures.MemoryRepository();
    final api = fixtures.Api()
      ..cloud = CloudSnapshot(
        data: fixtures.state(tripName: 'Private trip'),
        revision: 1,
      );
    final controller = AppController(
      engine: _LoungeEngine(),
      repository: repository,
      api: api,
      sessionStore: fixtures.MemorySession(fixtures.session()),
      identity: fixtures.Identity(),
      clock: () => DateTime.utc(2026, 10, 18),
    );
    await tester.pumpWidget(RephaseApp(controller: controller));
    await tester.pumpAndSettle();
    GoRouter.of(
      tester.element(find.byType(NavigationBar)),
    ).go('/lounges?airport=LAX&leg=private-leg');
    await tester.pumpAndSettle();
    expect(find.text('Before your flight · AA-PRIVATE'), findsOneWidget);
    GoRouter.of(tester.element(find.byType(NavigationBar))).go('/today');
    await tester.pumpAndSettle();
    await controller.signOut();
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('Lounges'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Before your flight · AA-PRIVATE'), findsNothing);
    final router = GoRouter.of(tester.element(find.byType(NavigationBar)));
    expect(router.routeInformationProvider.value.uri.queryParameters, isEmpty);
    expect(find.text('SFO · San Francisco'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });
}
