import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rephase/app_controller.dart';
import 'package:rephase/data/models.dart';
import 'package:rephase/notifications/reminder_gateway.dart';
import 'package:rephase/notifications/reminder_settings.dart';
import 'package:rephase/notifications/trip_reminder.dart';
import 'package:rephase/notifications/trip_reminders.dart';
import 'package:rephase/rephase_app.dart';

import 'data_controller_test.dart' as fixtures;

final now = DateTime.utc(2026, 10, 24, 20);
Preferences prefs({bool caffeine = true, bool melatonin = false}) =>
    Preferences.fromJson({'caffeine': caffeine, 'melatonin': melatonin});
Trip trip(String id, {List<Json> adherence = const []}) =>
    Trip.fromJson({'id': id, 'name': id, 'legs': [], 'adherence': adherence});
Json action(
  String id,
  String type,
  DateTime start,
  DateTime end, {
  String? origin,
}) => {
  'id': id,
  'type': type,
  'start': start.toUtc().toIso8601String(),
  'end': end.toUtc().toIso8601String(),
  'origin': ?origin,
};
Json response(List<Json> actions) => {
  'plan': {
    'days': [
      {'actions': actions},
    ],
  },
  'days': [
    {
      'id': 'travel-day',
      'timeline': {
        'start': now.millisecondsSinceEpoch,
        'end': now.add(const Duration(days: 7)).millisecondsSinceEpoch,
      },
    },
  ],
};
AppData data(List<Trip> trips, {Preferences? preferences, String? selected}) =>
    AppData.fromJson({
      'schemaVersion': 1,
      'preferences': (preferences ?? prefs()).toJson(),
      'trips': trips.map((trip) => trip.toJson()).toList(),
      'selectedTripId': selected,
    });

class MemorySettings implements ReminderSettingsStore {
  final values = <String, bool>{};
  @override
  Future<bool> enabled(String owner) async => values[owner] ?? false;
  @override
  Future<void> setEnabled(String owner, bool enabled) async {
    values[owner] = enabled;
  }
}

class Notifications implements ReminderGateway {
  bool permission = true;
  int permissionRequests = 0, schedules = 0, clearCalls = 0, tests = 0;
  bool failSchedule = false;
  Completer<void>? scheduling;
  final requests = <int, TripReminder>{};
  void Function(String?)? onTap;
  String? launchPayload;
  @override
  Future<void> initialize(void Function(String?) callback) async {
    onTap = callback;
    if (launchPayload != null) callback(launchPayload);
  }

  @override
  Future<bool> allowed() async => permission;
  @override
  Future<bool> requestPermission() async {
    permissionRequests++;
    return permission;
  }

  @override
  Future<List<PendingNotificationRequest>> pending() async => requests.entries
      .map(
        (e) => PendingNotificationRequest(
          e.key,
          e.value.title,
          e.value.body,
          e.value.payload,
        ),
      )
      .toList();
  @override
  Future<void> schedule(int id, TripReminder reminder) async {
    await scheduling?.future;
    if (failSchedule) throw StateError('OS refused request');
    schedules++;
    requests[id] = reminder;
  }

  @override
  Future<void> cancel(int id) async {
    requests.remove(id);
  }

  @override
  Future<void> cancelAll() async {
    clearCalls++;
    requests.clear();
  }

  @override
  Future<void> test() async {
    tests++;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'UTC survives date line and DST; midnight continuations never alert twice',
    () {
      final start = DateTime.parse('2026-10-24T23:30:00-07:00');
      final boundary = DateTime.parse('2026-10-26T00:00:00+11:00');
      final end = DateTime.parse('2026-10-26T02:00:00+11:00');
      final result = remindersForPlan(
        owner: 'guest',
        trip: trip('qf94'),
        preferences: prefs(),
        response: response([
          action('sleep-a', 'sleep', start, boundary),
          action('sleep-b', 'sleep', boundary, end),
          action('sleep-a', 'sleep', start, boundary),
        ]),
      );
      expect(result, hasLength(1));
      expect(result.single.at, DateTime.utc(2026, 10, 25, 6, 30));
      expect(result.single.dayId, 'travel-day');
      expect(nextReminders(result, boundary), isEmpty);
      final fold = remindersForPlan(
        owner: 'guest',
        trip: trip('dst'),
        preferences: prefs(),
        response: response([
          action(
            'early',
            'light',
            DateTime.parse('2026-11-01T01:30:00-04:00'),
            DateTime.parse('2026-11-01T01:45:00-04:00'),
          ),
          action(
            'late',
            'light',
            DateTime.parse('2026-11-01T01:30:00-05:00'),
            DateTime.parse('2026-11-01T01:45:00-05:00'),
          ),
        ]),
      );
      expect(fold[1].at.difference(fold[0].at), const Duration(hours: 1));
    },
  );
  test(
    'recorded actions, observations, past guidance and disabled aids are excluded',
    () {
      final start = now.add(const Duration(hours: 1)),
          end = now.add(const Duration(hours: 2));
      final result = remindersForPlan(
        owner: 'guest',
        trip: trip(
          't',
          adherence: [
            {'actionId': 'done', 'status': 'followed'},
          ],
        ),
        preferences: prefs(caffeine: false),
        response: response([
          action('done', 'light', start, end),
          action('observed', 'sleep', start, end, origin: 'observation'),
          action('coffee', 'caffeine', start, end),
          action('pill', 'melatonin', start, end),
          action(
            'past',
            'sleep',
            now.subtract(const Duration(hours: 2)),
            now.subtract(const Duration(hours: 1)),
          ),
          {...action('rest', 'sleep', start, end), 'sleepKind': 'rest'},
          action('dark', 'avoid-light', start, end),
        ]),
      );
      final queue = nextReminders(result, now);
      expect(
        queue.values.map((r) => r.title),
        containsAll(['Time to rest', 'Dim the lights']),
      );
      expect(queue, hasLength(2));
    },
  );
  test(
    'nearest 60 selected globally, deduplicated and stable across input order',
    () {
      final candidates = List.generate(
        90,
        (i) => TripReminder(
          owner: 'guest',
          tripId: 't${i % 3}',
          dayId: 'day',
          type: 'light',
          at: now.add(Duration(hours: i + 1)),
          title: 'Light',
          body: 'Plan',
        ),
      );
      final first = nextReminders([
            ...candidates.reversed,
            candidates.first,
          ], now),
          reordered = nextReminders(candidates, now);
      expect(first, hasLength(60));
      expect(first.keys, orderedEquals(reordered.keys));
      expect(first.values.first.at, now.add(const Duration(hours: 1)));
      expect(first.values.last.at, now.add(const Duration(hours: 60)));
      expect(first.keys.every((id) => id > 0 && id < testReminderId), isTrue);
    },
  );
  test(
    'opt-in schedules every saved trip; refresh is idempotent and deletion cancels',
    () async {
      final gateway = Notifications(), store = MemorySettings();
      var plans = 0;
      final service = TripReminders(
        gateway: gateway,
        settings: store,
        clock: () => now,
        plan: (trip, prefs, at) async {
          plans++;
          return response([
            action(
              '${trip.id}-light',
              'light',
              now.add(const Duration(hours: 1)),
              now.add(const Duration(hours: 2)),
            ),
          ]);
        },
      );
      addTearDown(service.dispose);
      service.update(
        accountId: null,
        data: data([trip('one'), trip('two')], selected: 'one'),
      );
      await service.refresh();
      expect(gateway.permissionRequests, 0);
      expect(plans, 0);
      await service.setEnabled(true);
      expect(gateway.requests.values.map((r) => r.tripId).toSet(), {
        'one',
        'two',
      });
      expect(store.values['guest'], isTrue);
      final count = gateway.schedules;
      await service.refresh();
      expect(gateway.schedules, count);
      expect(plans, 2);
      service.update(
        accountId: null,
        data: data([trip('two')], selected: 'two'),
      );
      await service.refresh();
      expect(gateway.requests.values.single.tripId, 'two');
      await service.setEnabled(false);
      expect(gateway.requests, isEmpty);
      expect(store.values['guest'], isFalse);
    },
  );
  test('edits and optional preferences replace stale guidance', () async {
    final gateway = Notifications(),
        store = MemorySettings()..values['guest'] = true;
    final service = TripReminders(
      gateway: gateway,
      settings: store,
      clock: () => now,
      plan: (trip, prefs, at) async => response([
        action(
          'light',
          'light',
          now.add(Duration(hours: trip.name == 'later' ? 3 : 1)),
          now.add(const Duration(hours: 4)),
        ),
        action(
          'melatonin',
          'melatonin',
          now.add(const Duration(hours: 5)),
          now.add(const Duration(hours: 6)),
        ),
      ]),
    );
    addTearDown(service.dispose);
    service.update(
      accountId: null,
      data: data([trip('t')], preferences: prefs(melatonin: true)),
    );
    await service.refresh();
    expect(gateway.requests, hasLength(2));
    service.update(
      accountId: null,
      data: data([
        trip('t').withChanges({'name': 'later'}),
      ]),
    );
    await service.refresh();
    expect(gateway.requests, hasLength(1));
    expect(
      gateway.requests.values.single.at,
      now.add(const Duration(hours: 3)),
    );
  });
  test(
    'sign-out during scheduling cannot leave an old account notification',
    () async {
      final gateway = Notifications(),
          store = MemorySettings()..values['account:alice'] = true;
      final service = TripReminders(
        gateway: gateway,
        settings: store,
        clock: () => now,
        plan: (trip, prefs, at) async => response([
          action(
            'light',
            'light',
            now.add(const Duration(hours: 1)),
            now.add(const Duration(hours: 2)),
          ),
        ]),
      );
      addTearDown(service.dispose);
      gateway.scheduling = Completer<void>();
      service.update(accountId: 'alice', data: data([trip('private')]));
      final pending = service.refresh();
      await Future<void>.delayed(Duration.zero);
      service.update(accountId: null, data: null);
      service.update(accountId: null, data: data([]));
      gateway.scheduling!.complete();
      await pending;
      expect(gateway.requests, isEmpty);
      expect(service.enabled, isFalse);
      expect(store.values['account:alice'], isTrue);
    },
  );
  test(
    'permission denial and revocation clear requests without automatic prompts',
    () async {
      final gateway = Notifications()..permission = false;
      final store = MemorySettings();
      final service = TripReminders(
        gateway: gateway,
        settings: store,
        clock: () => now,
        plan: (_, _, _) async => response([]),
      );
      addTearDown(service.dispose);
      service.update(accountId: null, data: data([]));
      await service.refresh();
      expect(gateway.permissionRequests, 0);
      await service.setEnabled(true);
      expect(service.enabled, isFalse);
      expect(service.error, contains('phone’s settings'));
      expect(store.values['guest'], isNot(true));
      gateway.permission = true;
      await service.setEnabled(true);
      gateway.permission = false;
      final calls = gateway.clearCalls;
      await service.refresh();
      expect(gateway.clearCalls, greaterThan(calls));
      expect(service.permitted, isFalse);
      expect(gateway.permissionRequests, 2);
    },
  );
  test('partial OS failures clear the queue and retry recovers', () async {
    final gateway = Notifications()..failSchedule = true;
    final store = MemorySettings()..values['guest'] = true;
    final service = TripReminders(
      gateway: gateway,
      settings: store,
      clock: () => now,
      plan: (_, _, _) async => response([
        action(
          'light',
          'light',
          now.add(const Duration(hours: 1)),
          now.add(const Duration(hours: 2)),
        ),
      ]),
    );
    addTearDown(service.dispose);
    service.update(accountId: null, data: data([trip('t')]));
    await service.refresh();
    expect(service.error, isNotNull);
    expect(gateway.requests, isEmpty);
    gateway.failSchedule = false;
    await service.refresh();
    expect(service.error, isNull);
    expect(gateway.requests, hasLength(1));
  });
  test(
    'restored opt-in refills a rolling queue and decodes notification taps',
    () async {
      var clock = now;
      final gateway = Notifications(),
          store = MemorySettings()..values['guest'] = true;
      final service = TripReminders(
        gateway: gateway,
        settings: store,
        clock: () => clock,
        plan: (_, _, _) async => response(
          List.generate(
            70,
            (i) => action(
              'light-$i',
              'light',
              now.add(Duration(hours: i + 1)),
              now.add(Duration(hours: i + 1, minutes: 30)),
            ),
          ),
        ),
      );
      addTearDown(service.dispose);
      service.update(accountId: null, data: data([trip('t')]));
      await service.refresh();
      expect(service.enabled, isTrue);
      expect(gateway.requests, hasLength(60));
      clock = now.add(const Duration(hours: 2));
      await service.refresh();
      expect(gateway.requests, hasLength(60));
      expect(gateway.requests.values.every((r) => r.at.isAfter(clock)), isTrue);
      expect(service.scheduledThrough, now.add(const Duration(hours: 62)));
      gateway.onTap!(gateway.requests.values.first.payload);
      expect(service.takeLink()?.tripId, 't');
      expect(service.pendingLink, isNull);
      expect(ReminderLink.parse('bad'), isNull);
    },
  );
  testWidgets(
    'cold and warm notification taps open their trip; other accounts are ignored',
    (tester) async {
      final repository = fixtures.MemoryRepository()
        ..values[null] = CachedState(
          data: data([trip('one'), trip('two')], selected: 'one'),
        );
      final controller = AppController(
        engine: fixtures.Engine(),
        repository: repository,
        api: fixtures.Api(),
        sessionStore: fixtures.MemorySession(null),
        identity: fixtures.Identity(),
        clock: () => now,
      );
      String payload(String owner, String tripId, String dayId) => TripReminder(
        owner: owner,
        tripId: tripId,
        dayId: dayId,
        type: 'sleep',
        at: now,
        title: 'Sleep',
        body: 'Sleep',
      ).payload;
      final gateway = Notifications()
        ..launchPayload = payload('guest', 'two', '2026-10-25');
      final service = TripReminders(
        gateway: gateway,
        settings: MemorySettings(),
        plan: controller.planForReminders,
        clock: () => now,
      );
      await tester.pumpWidget(
        RephaseApp(controller: controller, reminders: service),
      );
      await tester.pumpAndSettle();
      final router = GoRouter.of(tester.element(find.byType(NavigationBar)));
      expect(controller.selectedTrip?.id, 'two');
      expect(
        router.routeInformationProvider.value.uri.toString(),
        '/plan?day=2026-10-25',
      );
      gateway.onTap!(payload('guest', 'one', '2026-10-24'));
      await tester.pumpAndSettle();
      expect(controller.selectedTrip?.id, 'one');
      expect(
        router.routeInformationProvider.value.uri.queryParameters['day'],
        '2026-10-24',
      );
      router.go('/today');
      await tester.pumpAndSettle();
      gateway.onTap!(payload('account:someone-else', 'two', '2026-10-25'));
      gateway.onTap!(payload('guest', 'deleted', '2026-10-25'));
      await tester.pumpAndSettle();
      expect(controller.selectedTrip?.id, 'one');
      expect(router.routeInformationProvider.value.uri.path, '/today');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
  testWidgets(
    'settings opt-in prompts only on tap and offers a test reminder',
    (tester) async {
      final gateway = Notifications();
      final service = TripReminders(
        gateway: gateway,
        settings: MemorySettings(),
        clock: () => now,
        plan: (_, _, _) async => response([]),
      );
      service.update(accountId: null, data: data([]));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ReminderSettings(reminders: service),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(gateway.permissionRequests, 0);
      await tester.tap(find.text('Trip reminders'));
      await tester.pumpAndSettle();
      expect(gateway.permissionRequests, 1);
      await tester.tap(find.text('Send test reminder'));
      await tester.pumpAndSettle();
      expect(gateway.tests, 1);
      await tester.pumpWidget(const SizedBox());
      service.dispose();
    },
  );
}
