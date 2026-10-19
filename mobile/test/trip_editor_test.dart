import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rephase/app_controller.dart';
import 'package:rephase/data/models.dart';
import 'package:rephase/engine/mobile_engine.dart';
import 'package:rephase/features/trips/flight_fields.dart';
import 'package:rephase/features/trips/flight_leg_editor.dart';
import 'package:rephase/features/trips/trip_editor_screen.dart';

const _airports = [
  {
    'code': 'SYD',
    'city': 'Sydney',
    'name': 'Sydney Airport',
    'timeZone': 'Australia/Sydney',
  },
  {
    'code': 'HNL',
    'city': 'Honolulu',
    'name': 'Daniel K. Inouye International',
    'timeZone': 'Pacific/Honolulu',
  },
];

Map<String, dynamic> _leg() => {
  'id': 'leg-1',
  'flightNumber': 'QF103',
  'departureAirport': 'SYD',
  'arrivalAirport': 'HNL',
  'departureDateTime': '2026-10-17T20:30',
  'arrivalDateTime': '2026-10-17T09:00',
  'departureTimeZone': 'Australia/Sydney',
  'arrivalTimeZone': 'Pacific/Honolulu',
  'stayAfter': 'destination',
  'strategy': 'adapt',
  'travelClass': 'business',
  'lieFlat': true,
  'aircraft': {'model': 'Airbus A330-300'},
  'flightSource': 'aerodatabox',
  'flightFetchedAt': '2026-10-01T00:00:00Z',
  'providerRecordConfirmed': true,
  'futureLegField': {'keep': true},
};

class _Engine implements MobileEngine {
  @override
  Future<Map<String, dynamic>> call(
    String operation, [
    Map<String, dynamic> payload = const {},
  ]) async {
    if (operation == 'localTime') {
      if (payload['dateTime'] == '2026-11-01T01:30') {
        return {'valid': payload['disambiguation'] != null, 'ambiguous': true};
      }
      return {'valid': true, 'ambiguous': false};
    }
    if (operation == 'newLeg') {
      return {
        'leg': {
          ..._leg(),
          'id': 'leg-2',
          'flightNumber': '',
          'arrivalAirport': '',
        },
      };
    }
    throw StateError('Unexpected engine operation: $operation');
  }

  @override
  Future<void> dispose() async {}
}

class _Controller extends AppController {
  _Controller() : super(engine: _Engine());
  Trip saved = Trip.fromJson({
    'id': 'trip-1',
    'name': 'Hawaii',
    'createdAt': '2026-10-01T00:00:00Z',
    'updatedAt': '2026-10-01T00:00:00Z',
    'legs': [_leg()],
    'adherence': [
      {'id': 'record-1', 'actionId': 'sleep-1', 'status': 'completed'},
    ],
    'futureTripField': {'keep': 'yes'},
  });
  Trip? written;
  int lookups = 0;
  bool loggedIn = true;
  @override
  bool get signedIn => loggedIn;
  @override
  bool get flightLookupAvailable => true;
  @override
  List<Trip> get trips => [saved];
  @override
  Map<String, dynamic> get catalog => {'airports': _airports};
  @override
  Future<Map<String, dynamic>> lookupFlight(
    String flightNumber,
    String date, {
    String? departureAirport,
  }) async {
    lookups++;
    return {
      'fetchedAt': '2026-10-18T00:00:00Z',
      'candidates': [
        {
          ..._leg(),
          'id': 'candidate',
          'airline': 'Qantas',
          'durationMinutes': 570,
        },
      ],
    };
  }

  @override
  Future<void> saveTrip(Trip trip) async {
    written = trip;
  }
}

void main() {
  testWidgets(
    'lookup is compact, applies aircraft, and changing identity invalidates the old result',
    (tester) async {
      final controller = _Controller();
      addTearDown(controller.dispose);
      var leg = _leg();
      bool? resolved;
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(useMaterial3: true),
          home: Scaffold(
            body: SingleChildScrollView(
              child: StatefulBuilder(
                builder: (context, setState) => FlightLegEditor(
                  controller: controller,
                  leg: leg,
                  index: 0,
                  count: 1,
                  airports: _airports,
                  onChanged: (value) => setState(() => leg = value),
                  onResolved: (value) => resolved = value,
                  onMove: (_) {},
                  onDelete: () {},
                ),
              ),
            ),
          ),
        ),
      );
      expect(find.byType(AirportField), findsNothing);
      await tester.tap(find.text('Look up flight'));
      await tester.pumpAndSettle();
      expect(controller.lookups, 1);
      expect(find.text('Use this flight'), findsOneWidget);
      await tester.ensureVisible(find.text('Use this flight'));
      await tester.tap(find.text('Use this flight'));
      await tester.pumpAndSettle();
      expect(resolved, true);
      expect(leg['aircraft'], {'model': 'Airbus A330-300'});
      expect(leg['providerRecordConfirmed'], true);
      expect(leg['futureLegField'], {'keep': true});
      await tester.ensureVisible(find.byType(TextFormField).first);
      await tester.enterText(find.byType(TextFormField).first, 'QF104');
      await tester.pump();
      expect(resolved, false);
      expect(leg.containsKey('aircraft'), false);
      expect(leg.containsKey('providerRecordConfirmed'), false);
      expect(leg['flightSource'], 'manual');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'manual arrival follows departure until edited, then preserves the entered arrival',
    (tester) async {
      final controller = _Controller()..loggedIn = false;
      addTearDown(controller.dispose);
      var leg = {..._leg(), 'departureDateTime': '', 'arrivalDateTime': ''};
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: StatefulBuilder(
                builder: (context, setState) => FlightLegEditor(
                  controller: controller,
                  leg: leg,
                  index: 0,
                  count: 1,
                  airports: _airports,
                  onChanged: (value) => setState(() => leg = value),
                  onResolved: (_) {},
                  onMove: (_) {},
                  onDelete: () {},
                ),
              ),
            ),
          ),
        ),
      );
      expect(find.byType(AirportField), findsNothing);
      await tester.tap(find.text('Enter manually'));
      await tester.pumpAndSettle();
      expect(find.byType(AirportField), findsNWidgets(2));
      LocalDateTimeField field(String label) => tester
          .widgetList<LocalDateTimeField>(find.byType(LocalDateTimeField))
          .firstWhere((field) => field.label == label);
      field('Departure').onChanged('2026-10-18T20:30');
      await tester.pumpAndSettle();
      expect(leg['arrivalDateTime'], '2026-10-18T20:30');
      field('Arrival').onChanged('2026-10-18T09:00');
      await tester.pumpAndSettle();
      field('Departure').onChanged('2026-10-19T20:30');
      await tester.pumpAndSettle();
      expect(leg['arrivalDateTime'], '2026-10-18T09:00');
      field('Departure').onChanged('2026-11-01T01:30');
      await tester.pumpAndSettle();
      expect(find.text('Clock changes: which occurrence?'), findsOneWidget);
      final fold = find.byWidgetPredicate(
        (widget) =>
            widget is DropdownButtonFormField<String> &&
            widget.decoration.labelText == 'Clock changes: which occurrence?',
      );
      await tester.ensureVisible(fold);
      await tester.tap(fold);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Earlier occurrence').last);
      await tester.pumpAndSettle();
      expect(leg['departureDisambiguation'], 'earlier');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'editing a saved trip retains recorded activities and unknown schema fields',
    (tester) async {
      final controller = _Controller();
      controller.saved = controller.saved.withChanges({
        'legs': [
          _leg(),
          {..._leg(), 'id': 'leg-2', 'flightNumber': 'QF104'},
        ],
      });
      addTearDown(controller.dispose);
      final router = GoRouter(
        initialLocation: '/trips/trip-1/edit',
        routes: [
          GoRoute(
            path: '/trips/:id/edit',
            builder: (context, state) => TripEditorScreen(
              controller: controller,
              tripId: state.pathParameters['id'],
            ),
          ),
          GoRoute(
            path: '/plan',
            builder: (context, state) =>
                const Scaffold(body: Text('Saved plan')),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextFormField).first,
        'Hawaii and home',
      );
      await tester.ensureVisible(find.byTooltip('Move flight later').first);
      await tester.tap(find.byTooltip('Move flight later').first);
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Create my plan'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('Create my plan'));
      await tester.pumpAndSettle();
      expect(find.text('Saved plan'), findsOneWidget);
      expect(controller.written!.name, 'Hawaii and home');
      expect(controller.written!.updatedAt, controller.saved.updatedAt);
      expect(controller.written!.json['futureTripField'], {'keep': 'yes'});
      expect(controller.written!.legs.first.id, 'leg-2');
      expect(controller.written!.legs.first.json['futureLegField'], {
        'keep': true,
      });
      expect(controller.written!.adherence.single['id'], 'record-1');
      expect(tester.takeException(), isNull);
    },
  );
}
