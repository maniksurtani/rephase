import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rephase/app_controller.dart';
import 'package:rephase/data/models.dart';
import 'package:rephase/engine/mobile_engine.dart';
import 'package:rephase/features/plan/action_card.dart';
import 'package:rephase/features/plan/day_timeline.dart';
import 'package:rephase/features/plan/plan_screen.dart';
import 'package:rephase/features/today/today_screen.dart';
import 'package:rephase/ui/theme.dart';

Json clock(String time, {String date = '2026-10-18'}) => {
  'time': time,
  'date': date.endsWith('19') ? '19 Oct' : '18 Oct',
  'dateKey': date,
  'zone': 'HST',
};

Json advice(
  String id,
  String type,
  String title, {
  String date = '2026-10-18',
}) => {
  'id': id,
  'type': type,
  'title': title,
  'detail': type == 'melatonin'
      ? 'CDC guidance describes 0.5–1 mg.'
      : 'A practical window for your journey.',
  'reason': 'Timing helps your body clock adjust.',
  'start': '${date}T20:00:00Z',
  'end': '${date}T21:00:00Z',
  'timeZone': 'Pacific/Honolulu',
  'clock': clock('10:00', date: date),
  'endClock': clock('11:00', date: date),
  if (type == 'melatonin') 'dose': '0.5–1 mg',
  'evidenceUrl': 'https://www.cdc.gov/yellow-book/',
};

class _Engine implements MobileEngine {
  @override
  Future<Json> call(String operation, [Json payload = const {}]) async => {};
  @override
  Future<void> dispose() async {}
}

class _Controller extends AppController {
  _Controller(this.view) : super(engine: _Engine());
  Json view;
  final _trip = Trip.fromJson({
    'id': 'trip',
    'name': 'Hawaii and San Francisco',
    'legs': [],
    'adherence': [],
  });
  @override
  Trip get selectedTrip => _trip;
  @override
  List<Trip> get trips => [_trip];
  @override
  Json get mobilePlan => view;
  @override
  DateTime get now => DateTime(2026, 10, 18, 15, 45);
}

Widget host(Widget child, {double textScale = 1}) => MaterialApp(
  theme: rephaseTheme(),
  home: Scaffold(
    body: MediaQuery(
      data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
      child: child,
    ),
  ),
);

void mobileSize(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets(
    'melatonin usage, dose and source start folded and expand together',
    (tester) async {
      mobileSize(tester);
      final controller = _Controller({});
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        host(
          SingleChildScrollView(
            child: GuidanceCard(
              action: advice('melatonin', 'melatonin', 'Optional melatonin'),
              controller: controller,
            ),
          ),
        ),
      );
      expect(find.text('Optional melatonin'), findsOneWidget);
      expect(find.text('Melatonin guidance'), findsOneWidget);
      expect(find.text('CDC guidance describes 0.5–1 mg.'), findsNothing);
      expect(find.text('Read the source'), findsNothing);
      await tester.tap(find.text('Melatonin guidance'));
      await tester.pumpAndSettle();
      expect(find.text('CDC guidance describes 0.5–1 mg.'), findsOneWidget);
      expect(find.text('Informational dose range: 0.5–1 mg'), findsOneWidget);
      expect(find.text('Read the source'), findsOneWidget);
      await tester.tap(find.text('Melatonin guidance'));
      await tester.pumpAndSettle();
      expect(find.text('CDC guidance describes 0.5–1 mg.'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'the preflight lounge link precedes the flight and opens its airport context',
    (tester) async {
      mobileSize(tester);
      final controller = _Controller({});
      addTearDown(controller.dispose);
      final flight = <String, dynamic>{
        'id': 'leg',
        'flightNumber': 'AS812',
        'departureAirport': 'HNL',
        'arrivalAirport': 'SFO',
        'departureCity': 'Honolulu',
        'arrivalCity': 'San Francisco',
        'departureClock': clock('11:00'),
        'arrivalClock': {...clock('19:00'), 'zone': 'PDT'},
        'aircraft': {'model': 'Boeing 737'},
      };
      final lounge = <String, dynamic>{
        'id': 'lounge:leg',
        'kind': 'lounge',
        'start': 1000,
        'end': 1000,
        'lounge': {'legId': 'leg', 'airport': 'HNL'},
      };
      final travel = <String, dynamic>{
        'id': 'leg',
        'kind': 'flight',
        'start': 2000,
        'end': 9000,
        'flight': flight,
      };
      final day = <String, dynamic>{
        'id': '2026-10-18',
        'date': '2026-10-18',
        'city': 'Honolulu',
        'travelSegments': [flight],
        'timeline': {
          'start': 1000,
          'end': 9000,
          'entries': [lounge, travel],
          'bands': [
            {'kind': 'flight'},
          ],
        },
        'steps': [
          {
            'start': 1000,
            'end': 2000,
            'clock': clock('10:00'),
            'endClock': clock('11:00'),
            'compressed': false,
            'entries': [lounge],
            'bands': [],
          },
          {
            'start': 2000,
            'end': 9000,
            'clock': clock('11:00'),
            'endClock': clock('18:00'),
            'compressed': true,
            'entries': [travel],
            'bands': [
              {'kind': 'flight', 'start': 2000, 'end': 9000},
            ],
          },
        ],
        'lastClock': clock('18:00'),
      };
      String? opened;
      final router = GoRouter(
        routes: [
          GoRoute(
            path: '/',
            builder: (_, _) => Scaffold(
              body: SingleChildScrollView(
                child: DayTimeline(day: day, controller: controller),
              ),
            ),
          ),
          GoRoute(
            path: '/lounges',
            builder: (_, state) {
              opened = state.uri.toString();
              return const Scaffold(body: Text('Lounge Explorer'));
            },
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        MaterialApp.router(theme: rephaseTheme(), routerConfig: router),
      );
      expect(
        tester.getTopLeft(find.text('Explore HNL lounges')).dy,
        lessThan(tester.getTopLeft(find.text('HNL → SFO')).dy),
      );
      expect(find.text('Aircraft · Boeing 737'), findsNothing);
      expect(find.text('…'), findsNothing);
      await tester.tap(find.text('Explore HNL lounges'));
      await tester.pumpAndSettle();
      expect(opened, '/lounges?airport=HNL&leg=leg');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'date-line continuations keep sleep totals and show arrival without repeated flight details',
    (tester) async {
      mobileSize(tester);
      final controller = _Controller({});
      addTearDown(controller.dispose);
      num at(String iso) => DateTime.parse(iso).millisecondsSinceEpoch;
      Json local(String time, String date, String zone) => {
        'time': time,
        'date': '${date.substring(8)} Oct',
        'dateKey': date,
        'zone': zone,
      };
      final start = at('2026-10-25T06:40Z');
      final restStart = at('2026-10-25T11:16Z');
      final midnight = at('2026-10-25T13:00Z');
      final arrival = at('2026-10-25T22:30Z');
      final flight = {
        'id': 'qf94',
        'flightNumber': 'QF94',
        'arrivalCity': 'Melbourne',
        'arrivalAirport': 'MEL',
      };
      final continuing = {
        'id': 'qf94:continuation',
        'kind': 'flight',
        'phase': 'continuation',
        'start': start,
        'end': midnight,
        'continuesAfter': true,
        'flight': flight,
      };
      final rest = {
        'kind': 'action',
        'start': restStart,
        'end': midnight,
        'action': advice('rest', 'sleep', 'Rest or nap'),
        'sleepEpisode': {
          'start': restStart,
          'end': restStart + const Duration(hours: 8).inMilliseconds,
          'continuesAfter': true,
        },
      };
      final day = <String, dynamic>{
        'date': '2026-10-25',
        'travelSegments': [flight],
        'timeline': {
          'start': start,
          'end': midnight,
          'entries': [continuing, rest],
          'bands': [],
        },
        'steps': [
          {
            'start': start,
            'end': restStart,
            'clock': local('17:40', '2026-10-25', 'AEDT'),
            'entries': [continuing],
            'clockChange': {
              'city': 'Melbourne',
              'fromClock': local('23:40', '2026-10-24', 'PDT'),
              'toClock': local('17:40', '2026-10-25', 'AEDT'),
            },
          },
          {
            'start': restStart,
            'end': midnight,
            'clock': local('22:16', '2026-10-25', 'AEDT'),
            'entries': [rest],
          },
        ],
        'lastClock': local('00:00', '2026-10-26', 'AEDT'),
      };
      Widget timeline(Json day) => host(
        SingleChildScrollView(
          child: DayTimeline(day: day, controller: controller),
        ),
      );
      await tester.pumpWidget(timeline(day));
      expect(find.textContaining('Clock change · Melbourne'), findsOneWidget);
      expect(find.textContaining('QF94 · In flight'), findsOneWidget);
      expect(find.text('8 h total · continues after this day'), findsOneWidget);
      expect(find.text('Flight details'), findsNothing);

      final landing = {
        ...continuing,
        'id': 'qf94:arrival',
        'phase': 'arrival',
        'start': arrival,
        'end': arrival,
      };
      await tester.pumpWidget(
        timeline({
          'date': '2026-10-26',
          'timeline': {
            'start': arrival,
            'end': arrival,
            'entries': [landing],
            'bands': [],
          },
          'steps': [],
          'lastClock': local('09:30', '2026-10-26', 'AEDT'),
        }),
      );
      expect(find.text('QF94 · Arrive in Melbourne'), findsOneWidget);
      expect(find.text('Flight details'), findsNothing);
      expect(find.text('End of this day'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Sunday remains selectable without recommendations and supports large mobile text',
    (tester) async {
      mobileSize(tester);
      Json day(String date, String city) => {
        'id': date,
        'date': date,
        'city': city,
        'stage': 'destination',
        'label': 'Stay in $city',
        'travelSegments': [],
        'timeline': {'entries': []},
        'steps': [],
      };
      final controller = _Controller({
        'plan': {'summary': {}},
        'days': [
          day('2026-10-17', 'Honolulu'),
          day('2026-10-18', 'Honolulu'),
          {...day('2026-10-19', 'San Francisco'), 'tripComplete': true},
        ],
        'today': {'dayId': '2026-10-17'},
      });
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        host(PlanScreen(controller: controller), textScale: 1.5),
      );
      await tester.pumpAndSettle();
      expect(find.text('18'), findsOneWidget);
      await tester.tap(find.text('18'));
      await tester.pumpAndSettle();
      await tester.drag(find.byType(PlanScreen), const Offset(0, -320));
      await tester.pumpAndSettle();
      expect(find.text('Sunday, 18 October'), findsOneWidget);
      expect(
        find.text('No saved recommendations for this day.'),
        findsOneWidget,
      );
      expect(find.text('Stay in Honolulu'), findsOneWidget);
      expect(find.text('Trip complete'), findsNothing);
      await tester.ensureVisible(find.byTooltip('Next day'));
      await tester.tap(find.byTooltip('Next day'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Trip complete'));
      expect(find.text('Trip complete'), findsOneWidget);
      expect(find.text('Return to your usual routine.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Today uses the device clock and dates a following-day preview honestly',
    (tester) async {
      mobileSize(tester);
      final next = advice('next', 'sleep', 'Bedtime', date: '2026-10-19');
      final controller = _Controller({
        'days': [
          {'id': '2026-10-18', 'date': '2026-10-18'},
        ],
        'today': {
          'dayId': '2026-10-18',
          'isCurrentDay': true,
          'actionDate': '2026-10-19',
          'actionCity': 'Honolulu',
          'currentAction': null,
          'nextAction': next,
          'previewActions': [next],
          'previewFlights': [],
        },
      });
      addTearDown(controller.dispose);
      await tester.pumpWidget(host(TodayScreen(controller: controller)));
      await tester.pumpAndSettle();
      expect(find.text('Sunday, 18 October · 15:45'), findsOneWidget);
      expect(find.text('Next in your plan'), findsOneWidget);
      expect(find.text('Monday, 19 October · Honolulu'), findsOneWidget);
      expect(find.text('Today at a glance'), findsNothing);
      expect(find.text('Bedtime'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
