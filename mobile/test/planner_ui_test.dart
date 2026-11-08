import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rephase/app_controller.dart';
import 'package:rephase/data/models.dart';
import 'package:rephase/engine/mobile_engine.dart';
import 'package:rephase/features/plan/action_card.dart';
import 'package:rephase/features/plan/journey_timeline.dart';
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
    'continuous native bands keep flights separate, disclose guidance, and link lounges',
    (tester) async {
      mobileSize(tester);
      final controller = _Controller({});
      addTearDown(controller.dispose);
      final start = controller.now
          .subtract(const Duration(hours: 2))
          .millisecondsSinceEpoch;
      final flight = {
        'id': 'leg',
        'flightNumber': 'QF94',
        'departureAirport': 'LAX',
        'arrivalAirport': 'MEL',
        'departureCity': 'Los Angeles',
        'arrivalCity': 'Melbourne',
        'departureClock': clock('11:00'),
        'arrivalClock': clock('19:00'),
        'aircraft': {'model': 'Boeing 787'},
      };
      final journey = <String, dynamic>{
        'start': start,
        'end': start + 86400000,
        'height': 1900,
        'days': [
          {
            'date': '2026-10-18',
            'at': start,
            'y': 0,
            'city': 'Los Angeles',
            'travel': true,
          },
          {
            'date': '2026-10-19',
            'at': start + 43200000,
            'y': 1050,
            'city': 'Melbourne',
            'travel': true,
          },
        ],
        'points': [
          {
            'at': start,
            'end': start + 43200000,
            'top': 0,
            'y': 46,
            'height': 1004,
            'clock': clock('00:00'),
            'city': 'Los Angeles',
          },
          {
            'at': start + 43200000,
            'end': start + 86400000,
            'top': 1050,
            'y': 1194,
            'height': 586,
            'clock': clock('01:00', date: '2026-10-19'),
            'city': 'Melbourne',
          },
          {
            'at': start + 86400000,
            'end': start + 86400000,
            'top': 1780,
            'y': 1780,
            'height': 0,
            'clock': clock('12:00', date: '2026-10-19'),
            'city': 'Melbourne',
          },
        ],
        'ticks': [],
        'bands': [
          {
            'id': 'awake',
            'kind': 'awake',
            'label': 'Awake',
            'duration': '8h',
            'top': 46,
            'height': 500,
            'lane': 0,
            'laneCount': 1,
            'actions': [],
          },
          {
            'id': 'sleep',
            'kind': 'sleep',
            'label': 'Sleep',
            'duration': '8h',
            'top': 548,
            'height': 900,
            'lane': 0,
            'laneCount': 1,
            'actions': [advice('sleep', 'sleep', 'Bedtime')],
          },
          {
            'id': 'flight',
            'kind': 'flight',
            'top': 250,
            'height': 1250,
            'flight': flight,
          },
        ],
        'events': [
          {
            'top': 150,
            'entry': {
              'id': 'lounge:leg',
              'kind': 'lounge',
              'lounge': {'legId': 'leg', 'airport': 'LAX'},
            },
          },
          {
            'top': 250,
            'entry': {
              'id': 'leg',
              'kind': 'flight',
              'phase': 'departure',
              'flight': flight,
            },
          },
        ],
        'markers': [
          {
            'at': start,
            'top': 0,
            'height': 46,
            'kind': 'day',
            'clock': clock('00:00'),
            'city': 'Los Angeles',
          },
          {
            'at': start + 43200000,
            'top': 1050,
            'height': 144,
            'kind': 'clock',
            'fromClock': clock('07:00'),
            'clock': clock('01:00', date: '2026-10-19'),
            'fromCity': 'Los Angeles',
            'city': 'Melbourne',
            'change': '+18h',
          },
        ],
      };
      String? opened;
      final router = GoRouter(
        routes: [
          GoRoute(
            path: '/',
            builder: (_, _) => Scaffold(
              body: Padding(
                padding: const EdgeInsets.all(16),
                child: JourneyTimeline(
                  journey: journey,
                  controller: controller,
                ),
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
      await tester.pumpAndSettle();
      final band = find.byKey(const ValueKey('journey-band:awake'));
      final flightMarker = find.byKey(const ValueKey('journey-event:leg'));
      expect(
        tester.getTopRight(band).dx,
        lessThan(tester.getTopLeft(flightMarker).dx),
      );
      expect(
        find.byKey(const ValueKey('journey-flight-span:leg')),
        findsOneWidget,
      );
      await tester.ensureVisible(flightMarker);
      await tester.tap(flightMarker);
      await tester.pumpAndSettle();
      expect(find.text('Aircraft · Boeing 787'), findsNothing);
      await tester.tap(find.text('Flight details'));
      await tester.pumpAndSettle();
      expect(find.text('Aircraft · Boeing 787'), findsOneWidget);
      await tester.tap(find.byTooltip('Close details'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byKey(const ValueKey('journey-band:sleep')),
      );
      await tester.tap(
        find.byKey(const ValueKey('journey-band:sleep')),
        warnIfMissed: false,
      );
      await tester.pumpAndSettle();
      expect(find.text('Why this helps'), findsOneWidget);
      await tester.tap(find.text('Why this helps'));
      await tester.pumpAndSettle();
      expect(find.text('Timing helps your body clock adjust.'), findsOneWidget);
      await tester.tap(find.byTooltip('Close details'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byKey(const ValueKey('journey-date:2026-10-19')),
      );
      await tester.tap(find.byKey(const ValueKey('journey-date:2026-10-19')));
      await tester.pumpAndSettle();
      expect(find.text('CLOCK CHANGES +18h'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('journey-flight-span:leg')),
        findsOneWidget,
      );
      await tester.tap(find.text('Now').first);
      await tester.pumpAndSettle();
      final lounge = find.byKey(const ValueKey('journey-event:lounge:leg'));
      await tester.ensureVisible(lounge);
      await tester.tap(lounge);
      await tester.pumpAndSettle();
      expect(opened, '/lounges?airport=LAX&leg=leg');
      expect(tester.takeException(), isNull);

      controller.view = {
        'journey': journey,
        'plan': {'summary': {}},
        'days': [],
      };
      await tester.pumpWidget(
        host(PlanScreen(controller: controller), textScale: 1.5),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('journey-date:2026-10-19')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('CLOCK CHANGES +18h'), findsOneWidget);
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
