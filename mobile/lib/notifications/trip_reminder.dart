import 'dart:convert';

import '../data/models.dart';

const reminderLimit = 60; // Below iOS's 64 pending-notification limit.
const testReminderId = 2147483647;

class TripReminder {
  const TripReminder({
    required this.owner,
    required this.tripId,
    required this.dayId,
    required this.type,
    required this.at,
    required this.title,
    required this.body,
  });
  final String owner;
  final String tripId;
  final String dayId;
  final String type;
  final DateTime at;
  final String title;
  final String body;

  String get key => '$owner/$tripId/$type/${at.toUtc().toIso8601String()}';
  String get payload => jsonEncode({
    'v': 1,
    'owner': owner,
    'trip': tripId,
    'day': dayId,
    'type': type,
    'at': at.toUtc().toIso8601String(),
  });
}

class ReminderLink {
  const ReminderLink(this.owner, this.tripId, this.dayId);
  final String owner;
  final String tripId;
  final String dayId;

  static ReminderLink? parse(String? payload) {
    try {
      final value = jsonDecode(payload ?? '') as Map;
      if (value['v'] != 1 ||
          value['owner'] is! String ||
          value['trip'] is! String ||
          value['day'] is! String) {
        return null;
      }
      return ReminderLink(value['owner'], value['trip'], value['day']);
    } catch (_) {
      return null;
    }
  }
}

class _Window {
  _Window(this.action, this.start, this.end);
  final Json action;
  final DateTime start;
  DateTime end;
  String get kind => switch (action['type']) {
    'sleep' => 'sleep/${action['sleepKind'] ?? 'sleep'}',
    'light' => 'light/${action['feasibility'] ?? 'unknown'}',
    _ => '${action['type']}',
  };
}

/// Original action intervals, not the timeline's midnight/display fragments.
/// Join contiguous windows before filtering the past so a continuation cannot
/// become a second reminder halfway through sleep or light exposure.
List<TripReminder> remindersForPlan({
  required String owner,
  required Trip trip,
  required Preferences preferences,
  required Json response,
}) {
  const types = {'sleep', 'light', 'avoid-light', 'caffeine', 'melatonin'};
  final recorded = trip.adherence.map((record) => record['actionId']).toSet();
  final plan = response['plan'] as Map? ?? const {};
  final windows = <_Window>[];
  for (final day in jsonObjects(plan['days'])) {
    for (final action in jsonObjects(day['actions'])) {
      final type = action['type'];
      if (!types.contains(type) ||
          action['origin'] == 'observation' ||
          recorded.contains(action['id']) ||
          (type == 'caffeine' && !preferences.caffeine) ||
          (type == 'melatonin' && !preferences.melatonin)) {
        continue;
      }
      final start = DateTime.tryParse('${action['start']}')?.toUtc();
      final end = DateTime.tryParse('${action['end']}')?.toUtc();
      if (start == null || end == null || !end.isAfter(start)) continue;
      windows.add(_Window(action, start, end));
    }
  }
  windows.sort((a, b) => a.start.compareTo(b.start));
  final joined = <_Window>[];
  final lastByKind = <String, _Window>{};
  for (final window in windows) {
    final last = lastByKind[window.kind];
    if (last != null && !window.start.isAfter(last.end)) {
      if (window.end.isAfter(last.end)) last.end = window.end;
    } else {
      joined.add(window);
      lastByKind[window.kind] = window;
    }
  }
  final days = jsonObjects(response['days']);
  return joined.map((window) {
    final action = window.action;
    final type = action['type'] as String;
    final rest = action['sleepKind'] == 'rest';
    final title = switch (type) {
      'sleep' => rest ? 'Time to rest' : 'Time to sleep',
      'light' =>
        action['feasibility'] == 'daylight'
            ? 'Seek daylight'
            : 'Seek bright light',
      'avoid-light' => 'Dim the lights',
      'caffeine' => 'Optional caffeine',
      _ => 'Optional melatonin',
    };
    final instruction = switch (type) {
      'sleep' =>
        rest
            ? 'Take a rest break as shown in your plan.'
            : 'Try to sleep now. Open your plan for the full schedule.',
      'light' =>
        action['feasibility'] == 'daylight'
            ? 'Head outside for daylight when you can.'
            : 'Seek bright light as shown in your plan.',
      'avoid-light' => 'Reduce bright light and dim your screens.',
      'caffeine' => 'Your optional caffeine window is starting.',
      _ => 'Open your plan for timing and melatonin usage guidance.',
    };
    final instant = window.start.millisecondsSinceEpoch;
    final day = days.where((day) {
      final timeline = day['timeline'] as Map?;
      return timeline?['start'] is num &&
          timeline?['end'] is num &&
          instant >= (timeline!['start'] as num) &&
          instant < (timeline['end'] as num);
    }).firstOrNull;
    return TripReminder(
      owner: owner,
      tripId: trip.id,
      dayId: day?['id'] as String? ?? '',
      type: type,
      at: window.start,
      title: title,
      body: '${trip.name}: $instruction',
    );
  }).toList();
}

/// Stable, positive Android IDs; collision resolution is deterministic within
/// the queue and the payload comparison prevents confusing different requests.
Map<int, TripReminder> nextReminders(
  Iterable<TripReminder> reminders,
  DateTime now,
) {
  final future =
      reminders
          .where((r) => r.at.isAfter(now.add(const Duration(seconds: 5))))
          .toList()
        ..sort((a, b) {
          final order = a.at.compareTo(b.at);
          return order == 0 ? a.key.compareTo(b.key) : order;
        });
  final result = <int, TripReminder>{};
  final keys = <String>{};
  for (final reminder in future) {
    if (!keys.add(reminder.key)) continue;
    var hash = 0x811c9dc5;
    for (final byte in utf8.encode(reminder.key)) {
      hash = ((hash ^ byte) * 0x01000193) & 0x7fffffff;
    }
    var id = hash % (testReminderId - 1) + 1;
    while (result.containsKey(id)) {
      id = id % (testReminderId - 1) + 1;
    }
    result[id] = reminder;
    if (result.length == reminderLimit) break;
  }
  return result;
}
