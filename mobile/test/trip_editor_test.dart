import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rephase/app_controller.dart';
import 'package:rephase/data/models.dart';
import 'package:rephase/data/mobile_api.dart';
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
  ApiException? lookupError;
  List<Map<String, dynamic>> candidates = [
    {..._leg(), 'id': 'candidate', 'airline': 'Qantas', 'durationMinutes': 570},
  ];
  void expireAccount() {
    loggedIn = false;
    notifyListeners();
  }

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
    if (lookupError != null) throw lookupError!;
    return {'fetchedAt': '2026-10-18T00:00:00Z', 'candidates': candidates};
  }

  @override
  Future<void> saveTrip(Trip trip) async {
    written = trip;
  }
}

Widget _lookupEditor(
  _Controller controller,
  ValueChanged<Map<String, dynamic>> onChanged,
  ValueChanged<bool> onResolved,
) => MaterialApp(
  theme: ThemeData.dark(useMaterial3: true),
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(1.3)),
    child: child!,
  ),
  home: Scaffold(
    body: SingleChildScrollView(
      child: FlightLegEditor(
        controller: controller,
        leg: _leg(),
        index: 0,
        count: 1,
        airports: _airports,
        onChanged: onChanged,
        onResolved: onResolved,
        onMove: (_) {},
        onDelete: () {},
      ),
    ),
  ),
);

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
      expect(find.text('Travel class'), findsNothing);
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
      expect(leg['travelClass'], 'business');
      expect(leg['lieFlat'], true);
      await tester.ensureVisible(find.text('Seat & cabin'));
      await tester.tap(find.text('Seat & cabin'));
      await tester.pumpAndSettle();
      expect(find.text('Travel class'), findsOneWidget);
      expect(
        tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
        true,
      );
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
    'confirmation blocks outside taps and Back; rejection preserves the draft and multiple matches require selection',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final controller = _Controller();
      addTearDown(controller.dispose);
      controller.candidates.add({
        ...controller.candidates.first,
        'id': 'later',
        'departureDateTime': '2026-10-17T21:30',
      });
      var leg = _leg();
      bool? resolved;
      await tester.pumpWidget(
        _lookupEditor(
          controller,
          (value) => leg = value,
          (value) => resolved = value,
        ),
      );
      await tester.tap(find.text('Look up flight'));
      await tester.pumpAndSettle();
      expect(find.text('Choose your flight'), findsOneWidget);
      await tester.tapAt(const Offset(2, 2));
      await tester.binding.handlePopRoute();
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(leg, _leg());
      expect(resolved, isNull);
      await tester.tap(find.text('Reject'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(leg, _leg());
      expect(resolved, isNull);
      await tester.tap(find.text('Look up flight'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Use this flight').last);
      await tester.tap(find.text('Use this flight').last);
      await tester.pumpAndSettle();
      expect(leg['departureDateTime'], '2026-10-17T21:30');
      expect(resolved, true);
      expect(find.byType(AlertDialog), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'missing and invalid flights offer retry or manual entry without replacing the draft',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final controller = _Controller()..candidates = [];
      addTearDown(controller.dispose);
      var leg = _leg();
      bool? resolved;
      await tester.pumpWidget(
        _lookupEditor(
          controller,
          (value) => leg = value,
          (value) => resolved = value,
        ),
      );
      await tester.tap(find.text('Look up flight'));
      await tester.pumpAndSettle();
      expect(find.text('Flight not found'), findsOneWidget);
      expect(find.text('Use this flight'), findsNothing);
      await tester.tapAt(const Offset(2, 2));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      final number = tester.widget<TextField>(find.byType(TextField).first);
      expect(number.focusNode!.hasFocus, true);
      expect(number.controller!.text, 'QF103');
      expect(controller.lookups, 1);
      expect(leg, _leg());
      expect(resolved, isNull);
      await tester.tap(find.text('Look up flight'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('Enter manually'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.byType(AirportField), findsNWidgets(2));
      expect(leg, _leg());
      expect(resolved, true);
      await tester.ensureVisible(find.text('Look up flight'));
      await tester.tap(find.text('Look up flight'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('Enter manually'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(AirportField), findsNWidgets(2));
      controller.lookupError = const ApiException(
        'Use a valid flight number and departure date.',
        400,
      );
      await tester.ensureVisible(find.text('Look up flight'));
      await tester.tap(find.text('Look up flight'));
      await tester.pumpAndSettle();
      expect(find.text('Check your flight details'), findsOneWidget);
      expect(
        find.text('Use a valid flight number and departure date.'),
        findsOneWidget,
      );
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(number.focusNode!.hasFocus, true);
      controller.lookupError = const ApiException(
        'Flight provider is temporarily unavailable.',
        503,
      );
      await tester.ensureVisible(find.text('Look up flight'));
      await tester.tap(find.text('Look up flight'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(
        find.text('Flight provider is temporarily unavailable.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an account change or removed editor clears its confirmation without applying it',
    (tester) async {
      final controller = _Controller();
      addTearDown(controller.dispose);
      var applied = false;
      await tester.pumpWidget(
        _lookupEditor(controller, (_) => applied = true, (_) {}),
      );
      await tester.tap(find.text('Look up flight'));
      await tester.pumpAndSettle();
      controller.expireAccount();
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(applied, false);
      controller.loggedIn = true;
      await tester.pumpWidget(
        _lookupEditor(controller, (_) => applied = true, (_) {}),
      );
      await tester.tap(find.text('Look up flight'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: Text('Closed editor'))),
      );
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text('Closed editor'), findsOneWidget);
      expect(applied, false);
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
