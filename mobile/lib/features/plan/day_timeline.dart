import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app_controller.dart';
import '../../data/models.dart';
import '../../ui/common.dart';
import 'action_card.dart';
import 'flight_card.dart';

const _kinds = [
  'awake',
  'sleep',
  'rest',
  'light',
  'avoid-light',
  'caffeine',
  'melatonin',
  'flight',
];

String durationLabel(num milliseconds) {
  final minutes = (milliseconds / 60000).round().clamp(0, 100000);
  final hours = minutes ~/ 60;
  final rest = minutes % 60;
  return hours > 0 ? '$hours h${rest > 0 ? ' $rest min' : ''}' : '$minutes min';
}

String _entryKind(Json entry) {
  if (entry['kind'] == 'lounge') return '';
  if (entry['kind'] == 'flight') return 'flight';
  final action = mapOf(entry['action']);
  return action['type'] == 'sleep' && action['sleepKind'] == 'rest'
      ? 'rest'
      : labelOf(action, 'type');
}

/// Renders the shared timeline exactly in chronological order, without new advice.
class DayTimeline extends StatelessWidget {
  const DayTimeline({super.key, required this.day, required this.controller});
  final Json day;
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final timeline = mapOf(day['timeline']);
    final entries = jsonObjects(timeline['entries']);
    final steps = jsonObjects(day['steps']);
    if (entries.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 28),
        child: Text(
          'No saved recommendations for this day.',
          style: TextStyle(color: muted),
        ),
      );
    }
    final present = jsonObjects(
      timeline['bands'],
    ).map((band) => band['kind']).toSet();
    final clocks = <num, Json>{
      for (final step in steps) (step['start'] as num): mapOf(step['clock']),
      if (timeline['end'] is num)
        (timeline['end'] as num): mapOf(day['lastClock']),
    };
    final travel = jsonObjects(day['travelSegments']).isNotEmpty;
    final tail = entries.where((entry) => entry['start'] == timeline['end']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'YOUR DAY, IN ORDER',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: muted,
                  letterSpacing: 1.7,
                ),
              ),
            ),
            Text(
              durationLabel(
                (timeline['end'] as num) - (timeline['start'] as num),
              ),
              style: const TextStyle(color: muted, fontSize: 12),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Wrap(
          spacing: 14,
          runSpacing: 10,
          children: [
            for (final kind in _kinds.where(present.contains))
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    guidanceIcon(kind),
                    size: 14,
                    color: guidanceColor(kind),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    guidanceLabel(kind),
                    style: TextStyle(color: guidanceColor(kind), fontSize: 12),
                  ),
                ],
              ),
          ],
        ),
        const SizedBox(height: 24),
        for (final step in steps) _step(context, step, clocks, travel),
        _TimelineRow(
          clock: mapOf(day['lastClock']),
          showDate: travel || mapOf(day['lastClock'])['dateKey'] != day['date'],
          showZone: travel,
          bands: const [],
          compressed: false,
          last: true,
          children: [
            for (final entry in tail) _entry(context, entry, clocks),
            const Text(
              'End of this day',
              style: TextStyle(color: muted, fontSize: 13),
            ),
          ],
        ),
      ],
    );
  }

  Widget _step(
    BuildContext context,
    Json step,
    Map<num, Json> clocks,
    bool travel,
  ) {
    final entries = jsonObjects(step['entries']);
    final bands = jsonObjects(step['bands']);
    final represented = entries.map(_entryKind).toSet();
    final fresh = bands
        .where(
          (band) =>
              band['start'] == step['start'] &&
              !represented.contains(band['kind']),
        )
        .toList();
    // An awake span interrupted by a point event receives one fresh caption.
    if (fresh.isEmpty &&
        step['compressed'] == true &&
        entries.isEmpty &&
        bands.length == 1 &&
        bands.first['kind'] == 'awake') {
      fresh.add(bands.first);
    }
    final unique = <String>{};
    final clock = mapOf(step['clock']);
    final dual = jsonObjects(step['dualClocks']);
    return _TimelineRow(
      key: ValueKey('step:${step['start']}'),
      clock: clock,
      showDate: travel || clock['dateKey'] != day['date'],
      showZone: travel,
      bands: bands,
      compressed: step['compressed'] == true,
      children: [
        if (travel && dual.isNotEmpty && entries.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final clock in dual)
                  Text(
                    '${clock['airport']} · ${clockLabel(clock, date: true)}',
                    style: const TextStyle(color: muted, fontSize: 11),
                  ),
              ],
            ),
          ),
        for (final band in fresh)
          if (unique.add(labelOf(band, 'kind')))
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _status(labelOf(band, 'kind'), clocks[band['end']]),
            ),
        for (final entry in entries) _entry(context, entry, clocks),
      ],
    );
  }

  Widget _status(String kind, Json? end) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(guidanceIcon(kind), color: guidanceColor(kind), size: 16),
      const SizedBox(width: 7),
      Expanded(
        child: Text(
          '${guidanceLabel(kind)}${end == null ? '' : ' · until ${clockLabel(end, date: end['dateKey'] != day['date'])}'}',
          style: TextStyle(color: guidanceColor(kind), fontSize: 13),
        ),
      ),
    ],
  );

  Widget _entry(BuildContext context, Json entry, Map<num, Json> clocks) {
    if (entry['kind'] == 'lounge') {
      final lounge = mapOf(entry['lounge']);
      return Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            key: ValueKey('lounge:${lounge['legId']}'),
            onPressed: () => context.go(
              Uri(
                path: '/lounges',
                queryParameters: {
                  'airport': labelOf(lounge, 'airport'),
                  'leg': labelOf(lounge, 'legId'),
                },
              ).toString(),
            ),
            icon: const Icon(Icons.chair_outlined, size: 17),
            label: Text('Explore ${lounge['airport']} lounges'),
          ),
        ),
      );
    }
    final kind = _entryKind(entry);
    final start = entry['start'] as num;
    final end = entry['end'] as num;
    final endClock = clocks[end];
    final caption = entry['kind'] == 'flight' && start == end
        ? 'Arrival'
        : '${entry['continuesBefore'] == true ? 'Continued · ' : ''}${durationLabel(end - start)}${entry['continuesAfter'] == true
              ? ' · continues after this day'
              : endClock == null
              ? ''
              : ' · until ${clockLabel(endClock, date: endClock['dateKey'] != day['date'])}'}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(
            children: [
              Icon(guidanceIcon(kind), size: 14, color: guidanceColor(kind)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  caption,
                  style: TextStyle(color: guidanceColor(kind), fontSize: 12),
                ),
              ),
            ],
          ),
        ),
        entry['kind'] == 'flight'
            ? FlightCard(flight: mapOf(entry['flight']))
            : GuidanceCard(
                action: mapOf(entry['action']),
                controller: controller,
                showTime: false,
              ),
      ],
    );
  }
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({
    super.key,
    required this.clock,
    required this.showDate,
    required this.showZone,
    required this.bands,
    required this.compressed,
    required this.children,
    this.last = false,
  });
  final Json clock;
  final bool showDate;
  final bool showZone;
  final List<Json> bands;
  final bool compressed;
  final bool last;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Stack(
    children: [
      Positioned(
        top: 0,
        bottom: 0,
        left: 58,
        width: 25,
        child: ExcludeSemantics(
          child: CustomPaint(
            painter: _TimelineRail(bands, compressed: compressed, last: last),
          ),
        ),
      ),
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 58,
            child: Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    labelOf(clock, 'time'),
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (showDate)
                    Text(
                      labelOf(clock, 'date'),
                      style: const TextStyle(color: muted, fontSize: 11),
                    ),
                  if (showZone)
                    Text(
                      labelOf(clock, 'zone'),
                      style: const TextStyle(color: muted, fontSize: 10),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 34),
          Expanded(
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight: last
                    ? 50
                    : compressed
                    ? 88
                    : 64,
              ),
              child: Padding(
                padding: EdgeInsets.only(bottom: last ? 0 : 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: children,
                ),
              ),
            ),
          ),
        ],
      ),
    ],
  );
}

class _TimelineRail extends CustomPainter {
  _TimelineRail(this.bands, {required this.compressed, required this.last});
  final List<Json> bands;
  final bool compressed;
  final bool last;
  @override
  void paint(Canvas canvas, Size size) {
    final base = Paint()
      ..color = muted.withValues(alpha: .35)
      ..strokeWidth = 3;
    void line(double x, Paint paint) {
      if (last) return;
      if (compressed) {
        for (double y = 8; y < size.height; y += 9) {
          canvas.drawLine(
            Offset(x, y),
            Offset(x, (y + 4).clamp(0, size.height)),
            paint,
          );
        }
      } else {
        canvas.drawLine(Offset(x, 8), Offset(x, size.height), paint);
      }
    }

    line(4, base);
    for (final band in bands) {
      final kind = labelOf(band, 'kind');
      final lane = switch (kind) {
        'awake' || 'sleep' || 'rest' => 0,
        'light' => 1,
        'avoid-light' => 2,
        'caffeine' => 3,
        'melatonin' => 4,
        _ => 5,
      };
      line(
        8 + lane * 3,
        Paint()
          ..color = guidanceColor(kind).withValues(alpha: .8)
          ..strokeWidth = 2,
      );
    }
    canvas.drawCircle(const Offset(4, 8), 4.5, Paint()..color = panel);
    canvas.drawCircle(
      const Offset(4, 8),
      4,
      Paint()
        ..color = muted
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );
    canvas.drawCircle(const Offset(4, 8), 1.6, Paint()..color = violet);
  }

  @override
  bool shouldRepaint(_TimelineRail oldDelegate) =>
      oldDelegate.bands != bands ||
      oldDelegate.compressed != compressed ||
      oldDelegate.last != last;
}
