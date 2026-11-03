import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../data/models.dart';
import 'reminder_gateway.dart';
import 'trip_reminder.dart';

typedef ReminderPlanner =
    Future<Json> Function(Trip trip, Preferences preferences, DateTime now);

/// One serialized, replaceable queue for the active account on this device.
/// OS scheduling owns delivery; no Dart timer or server is needed while closed.
class TripReminders extends ChangeNotifier with WidgetsBindingObserver {
  TripReminders({
    required this.gateway,
    required this.settings,
    required this.plan,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final ReminderGateway gateway;
  final ReminderSettingsStore settings;
  final ReminderPlanner plan;
  final DateTime Function() _clock;
  final _plans = <String, Json>{};
  AppData? _data;
  String _owner = 'guest';
  String? _loadedOwner;
  String? _input;
  String? _scheduledInput;
  Future<void>? _initializing;
  Future<void>? _working;
  DateTime? _refreshAt;
  int _revision = 0;
  bool _seenData = false;
  bool _disposed = false;
  bool _observing = false;
  bool _changingSetting = false;
  ReminderLink? _link;

  bool enabled = false;
  bool permitted = false;
  bool busy = false;
  int scheduledCount = 0;
  DateTime? scheduledThrough;
  String? error;
  bool get changingSetting => _changingSetting;
  ReminderLink? get pendingLink => _link;
  static String ownerKey(String? accountId) =>
      accountId == null ? 'guest' : 'account:$accountId';

  ReminderLink? takeLink() {
    final link = _link;
    _link = null;
    return link;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  bool _current(int revision) => !_disposed && revision == _revision;

  Future<void> _initialize() => _initializing ??= gateway
      .initialize((payload) {
        _link = ReminderLink.parse(payload);
        _notify();
      })
      .catchError((Object error) {
        _initializing = null;
        throw error;
      });

  void update({required String? accountId, required AppData? data}) {
    if (_disposed || (data == null && !_seenData)) return;
    _seenData = true;
    if (!_observing) {
      WidgetsBinding.instance.addObserver(this);
      _observing = true;
    }
    final owner = ownerKey(accountId);
    final input = jsonEncode({
      'owner': owner,
      'preferences': data?.preferences.toJson(),
      'trips': data?.trips.map((trip) => trip.toJson()).toList(),
    });
    final changed = input != _input;
    _data = data;
    _owner = owner;
    _input = input;
    if (changed ||
        (enabled && _refreshAt != null && !_clock().isBefore(_refreshAt!))) {
      unawaited(refresh());
    }
  }

  Future<void> refresh() {
    if (_disposed || !_seenData) return Future.value();
    _revision++;
    if (_working != null) return _working!;
    final completion = Completer<void>();
    _working = completion.future;
    unawaited(
      _drain().whenComplete(() {
        _working = null;
        completion.complete();
        busy = false;
        _notify();
      }),
    );
    return completion.future;
  }

  Future<void> _drain() async {
    busy = true;
    _notify();
    var applied = -1;
    while (!_disposed && applied != _revision) {
      final revision = _revision;
      try {
        await _initialize();
        if (_current(revision)) await _reconcile(revision);
      } catch (problem) {
        if (kDebugMode) debugPrint('Trip reminders: $problem');
        if (_current(revision)) {
          error = 'Could not update reminders. Try again.';
          scheduledCount = 0;
          scheduledThrough = null;
          // A partial schedule must not be presented as complete.
          try {
            await gateway.cancelAll();
          } catch (_) {
            /* Retry on refresh. */
          }
          _scheduledInput = null;
        }
      }
      applied = revision;
    }
  }

  Future<void> _reconcile(int revision) async {
    final owner = _owner;
    final data = _data;
    final input = _input;
    error = null;
    if (_loadedOwner != owner || data == null || _scheduledInput != input) {
      // Invalidate old guidance before potentially slow replanning. A later
      // edit/account switch supersedes this run before it may schedule anything.
      await gateway.cancelAll();
      scheduledCount = 0;
      scheduledThrough = null;
      if (!_current(revision)) return;
    }
    if (_loadedOwner != owner) {
      _plans.clear();
      enabled = await settings.enabled(owner);
      if (!_current(revision)) return;
      _loadedOwner = owner;
    }
    permitted = await gateway.allowed();
    if (!_current(revision)) return;
    if (!enabled || !permitted || data == null) {
      await gateway.cancelAll();
      scheduledCount = 0;
      scheduledThrough = null;
      _scheduledInput = input;
      _refreshAt = _clock().add(const Duration(hours: 1));
      return;
    }
    final candidates = <TripReminder>[];
    final used = <String>{};
    for (final trip in data.trips) {
      // Local arrival strings deliberately lack offsets. Three elapsed days is
      // a conservative exclusion for the one-day post-arrival plan in any zone.
      final arrivals =
          trip.legs
              .map((leg) => DateTime.tryParse('${leg.arrivalDateTime}Z'))
              .whereType<DateTime>()
              .toList()
            ..sort();
      if (arrivals.isNotEmpty &&
          arrivals.last.isBefore(
            _clock().toUtc().subtract(const Duration(days: 3)),
          )) {
        continue;
      }
      final key = jsonEncode({
        'trip': trip.toJson(),
        'preferences': data.preferences.toJson(),
      });
      used.add(key);
      final response =
          _plans[key] ?? await plan(trip, data.preferences, _clock());
      if (!_current(revision)) return;
      _plans[key] = response;
      candidates.addAll(
        remindersForPlan(
          owner: owner,
          trip: trip,
          preferences: data.preferences,
          response: response,
        ),
      );
    }
    _plans.removeWhere((key, _) => !used.contains(key));
    final desired = nextReminders(candidates, _clock());
    final existing = await gateway.pending();
    if (!_current(revision)) return;
    for (final request in existing) {
      final replacement = desired[request.id];
      if (replacement == null ||
          request.payload != replacement.payload ||
          request.title != replacement.title ||
          request.body != replacement.body) {
        await gateway.cancel(request.id);
        if (!_current(revision)) return;
      }
    }
    for (final entry in desired.entries) {
      final old = existing
          .where((request) => request.id == entry.key)
          .firstOrNull;
      if (old?.payload == entry.value.payload &&
          old?.title == entry.value.title &&
          old?.body == entry.value.body) {
        continue;
      }
      if (!entry.value.at.isAfter(_clock())) continue;
      await gateway.schedule(entry.key, entry.value);
      if (!_current(revision)) return;
    }
    scheduledCount = desired.length;
    scheduledThrough = desired.values.lastOrNull?.at;
    _scheduledInput = input;
    _refreshAt =
        desired.values.firstOrNull?.at.add(const Duration(seconds: 1)) ??
        _clock().add(const Duration(hours: 1));
    _notify();
  }

  Future<void> setEnabled(bool value) async {
    if (_disposed || _data == null || _changingSetting) return;
    final owner = _owner;
    _changingSetting = true;
    error = null;
    _notify();
    try {
      await _initialize();
      if (value) {
        final allowed = await gateway.requestPermission();
        if (_disposed || owner != _owner) return;
        permitted = allowed;
        if (!allowed) {
          error =
              'Allow Rephase notifications in your phone’s settings to enable reminders.';
          return;
        }
      }
      await settings.setEnabled(owner, value);
      if (_disposed || owner != _owner) return;
      enabled = value;
      await refresh();
    } catch (problem) {
      error = 'Could not change reminders. Try again.';
      if (kDebugMode) debugPrint('Trip reminder permission: $problem');
    } finally {
      _changingSetting = false;
      _notify();
    }
  }

  Future<void> sendTest() async {
    try {
      if (await gateway.allowed()) {
        await gateway.test();
      } else {
        permitted = false;
        error = 'Allow Rephase notifications in your phone’s settings first.';
      }
    } catch (_) {
      error = 'Could not send a test reminder. Try again.';
    }
    _notify();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(refresh());
  }

  @override
  void dispose() {
    _disposed = true;
    _revision++;
    if (_observing) WidgetsBinding.instance.removeObserver(this);
    // Keep OS requests when the app closes; sign-out/deletion uses update().
    super.dispose();
  }
}
