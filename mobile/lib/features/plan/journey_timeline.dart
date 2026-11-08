import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app_controller.dart';
import '../../data/models.dart';
import '../../ui/common.dart';
import 'action_card.dart';
import 'flight_card.dart';

double _number(Json item, String key) => (item[key] as num? ?? 0).toDouble();
String _date(String value) {
  final date = DateTime.tryParse(value);
  return date == null ? value : DateFormat('EEE, d MMM').format(date);
}

/// Native presentation of the shared engine's elapsed-time geometry.
/// Flutter never calculates a new timezone handoff or recommendation.
class JourneyTimeline extends StatefulWidget {
  const JourneyTimeline({
    super.key,
    required this.journey,
    required this.controller,
    this.initialDay,
  });
  final Json journey;
  final AppController controller;
  final String? initialDay;

  @override
  State<JourneyTimeline> createState() => _JourneyTimelineState();
}

class _JourneyTimelineState extends State<JourneyTimeline> {
  final _scroll = ScrollController();
  final _dates = ScrollController();
  double _position = 0;
  double _scale = 1;
  bool _initialized = false;
  String? _visibleDate;
  List<Json> get _points => jsonObjects(widget.journey['points']);

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  @override
  void didUpdateWidget(covariant JourneyTimeline oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialDay != oldWidget.initialDay &&
        widget.initialDay != null) {
      final day = jsonObjects(
        widget.journey['days'],
      ).where((d) => d['date'] == widget.initialDay).firstOrNull;
      if (day != null) {
        WidgetsBinding.instance.addPostFrameCallback(
          (_) => _jump(_number(day, 'y')),
        );
      }
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    _dates.dispose();
    super.dispose();
  }

  double _at(num instant) {
    final points = _points;
    if (points.isEmpty) return 0;
    for (final p in points) {
      final start = _number(p, 'at'), end = _number(p, 'end');
      if (instant >= start && instant < end) {
        return _number(p, 'y') +
            _number(p, 'height') * (instant - start) / (end - start);
      }
    }
    return instant <= _number(points.first, 'at')
        ? _number(points.first, 'y')
        : _number(points.last, 'y');
  }

  void _jump(double y, {bool animate = true}) {
    if (!mounted || !_scroll.hasClients) return;
    final target = (y * _scale).clamp(0.0, _scroll.position.maxScrollExtent);
    if (animate && !MediaQuery.of(context).disableAnimations) {
      _scroll.animateTo(
        target,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOut,
      );
    } else {
      _scroll.jumpTo(target);
    }
  }

  Json get _point =>
      _points.reversed
          .where((p) => _number(p, 'top') <= _position + 8)
          .firstOrNull ??
      _points.firstOrNull ??
      {};

  void _onScroll() {
    if (!mounted) return;
    setState(() => _position = _scroll.offset / _scale);
    _showDate();
  }

  void _showDate() {
    final date = labelOf(mapOf(_point['clock']), 'dateKey');
    if (_visibleDate == date) return;
    _visibleDate = date;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_dates.hasClients) return;
      final index = jsonObjects(
        widget.journey['days'],
      ).indexWhere((day) => day['date'] == date);
      if (index < 0) return;
      final offset = (index * 94.0 - 94).clamp(
        0.0,
        _dates.position.maxScrollExtent,
      );
      _dates.jumpTo(offset);
    });
  }

  void _sheet(String title, List<Widget> children) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .78,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    tooltip: 'Close details',
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              ...children,
            ],
          ),
        ),
      ),
    );
  }

  void _bandDetails(Json band) {
    _sheet(labelOf(band, 'label'), [
      Text(labelOf(band, 'duration'), style: const TextStyle(color: muted)),
      for (final action in jsonObjects(band['actions']))
        GuidanceCard(action: action, controller: widget.controller),
      if (jsonObjects(band['actions']).isEmpty)
        const Padding(
          padding: EdgeInsets.only(top: 14),
          child: Text(
            'Awake time; other guidance can happen at the same time.',
          ),
        ),
    ]);
  }

  void _eventDetails(Json entry) {
    if (entry['kind'] == 'lounge') {
      final lounge = mapOf(entry['lounge']);
      context.go(
        Uri(
          path: '/lounges',
          queryParameters: {
            'airport': labelOf(lounge, 'airport'),
            'leg': labelOf(lounge, 'legId'),
          },
        ).toString(),
      );
    } else {
      _sheet('Your flight', [FlightCard(flight: mapOf(entry['flight']))]);
    }
  }

  void _key() => _sheet('Reading your timeline', [
    const Text(
      'Bands at the same height happen at the same time. Tap a band or flight for details.',
    ),
    for (final item in const [
      ('awake', 'Awake time'),
      ('sleep', 'A window for sleep'),
      ('rest', 'An opportunity to rest or nap'),
      ('light', 'Seek daylight'),
      ('avoid-light', 'Keep light levels low'),
      ('caffeine', 'Optional caffeine'),
      ('melatonin', 'Optional melatonin; tap for usage guidance'),
      ('flight', 'Your flight'),
    ])
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(guidanceIcon(item.$1), color: guidanceColor(item.$1)),
        title: Text(item.$2),
      ),
    const Text(
      'The folded line changes the displayed clock during a flight. Both clocks show the same instant. Dotted sections compress quiet awake time.',
    ),
  ]);

  @override
  Widget build(BuildContext context) {
    final journey = widget.journey;
    final points = _points;
    final days = jsonObjects(journey['days']);
    if (points.isEmpty) {
      return const Center(
        child: Text('Add flight details to build your plan.'),
      );
    }
    // Allow extra vertical room when larger text wraps inside the narrow tracks.
    _scale =
        1 + math.max(0, MediaQuery.textScalerOf(context).scale(1) - 1) * 1.6;
    if (!_initialized) {
      _initialized = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final now = widget.controller.now.millisecondsSinceEpoch;
        final requested = days
            .where((d) => d['date'] == widget.initialDay)
            .firstOrNull;
        final target = requested != null
            ? _number(requested, 'y')
            : now >= _number(journey, 'start') && now < _number(journey, 'end')
            ? _at(now) - 80
            : now >= _number(journey, 'end')
            ? _number(days.last, 'y')
            : 0.0;
        _jump(target, animate: false);
        _showDate();
      });
    }
    final clock = mapOf(_point['clock']);
    final now = widget.controller.now.millisecondsSinceEpoch;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 108 * math.min(_scale, 1.5),
          child: ListView.separated(
            controller: _dates,
            scrollDirection: Axis.horizontal,
            itemCount: days.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (context, i) {
              final day = days[i], selected = day['date'] == clock['dateKey'];
              final date = DateTime.tryParse(labelOf(day, 'date'));
              final color = selected
                  ? violet
                  : day['travel'] == true
                  ? amber
                  : muted;
              return SizedBox(
                width: 86,
                child: Semantics(
                  selected: selected,
                  button: true,
                  label: '${_date(labelOf(day, 'date'))}, ${day['city']}',
                  child: Material(
                    color: color.withValues(alpha: .10),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(32),
                      side: BorderSide(color: color.withValues(alpha: .6)),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: InkWell(
                      key: ValueKey('journey-date:${day['date']}'),
                      onTap: () => _jump(_number(day, 'y')),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 10,
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              date == null
                                  ? ''
                                  : DateFormat('EEE').format(date),
                              style: TextStyle(color: color, fontSize: 11),
                            ),
                            Text(
                              '${date?.day ?? ''}',
                              style: TextStyle(color: color, fontSize: 25),
                            ),
                            Flexible(
                              child: Text(
                                day['travel'] == true
                                    ? '✈ Travel'
                                    : labelOf(day, 'city'),
                                textAlign: TextAlign.center,
                                maxLines: 2,
                                style: TextStyle(color: color, fontSize: 10),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _date(labelOf(clock, 'dateKey')),
                      style: const TextStyle(fontSize: 12),
                    ),
                    Text(
                      '${_point['city']} · ${clock['zone']}',
                      style: const TextStyle(color: muted, fontSize: 11),
                    ),
                  ],
                ),
              ),
              TextButton(
                onPressed: () => _jump(_at(now) - 80),
                child: const Text('Now'),
              ),
              TextButton(onPressed: _key, child: const Text('Key')),
            ],
          ),
        ),
        Expanded(
          child: LayoutBuilder(
            builder: (context, constraints) {
              const clockWidth = 46.0, flightWidth = 68.0;
              final track =
                  (constraints.maxWidth - clockWidth - flightWidth - 20) / 3;
              return SingleChildScrollView(
                controller: _scroll,
                key: const ValueKey('journey-scroll'),
                child: SizedBox(
                  height: _number(journey, 'height') * _scale,
                  width: constraints.maxWidth,
                  child: Stack(
                    children: [
                      for (final point in points.where(
                        (p) => _number(p, 'end') > _number(p, 'at'),
                      ))
                        Positioned(
                          top: _number(point, 'y') * _scale,
                          left: 41,
                          height: _number(point, 'height') * _scale,
                          width: 2,
                          child: CustomPaint(
                            painter: _RailPainter(
                              dotted: point['compressed'] == true,
                            ),
                          ),
                        ),
                      for (final tick in jsonObjects(journey['ticks']))
                        Positioned(
                          top: _number(tick, 'top') * _scale - 7,
                          left: 0,
                          right: 8,
                          child: Row(
                            children: [
                              SizedBox(
                                width: 36,
                                child: Text(
                                  labelOf(mapOf(tick['clock']), 'time'),
                                  textAlign: TextAlign.right,
                                  style: const TextStyle(
                                    color: muted,
                                    fontSize: 9,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 7),
                              const Expanded(
                                child: Divider(
                                  height: 1,
                                  color: Color(0xff2b2e40),
                                ),
                              ),
                            ],
                          ),
                        ),
                      for (final band in jsonObjects(journey['bands']))
                        if (band['kind'] == 'flight')
                          Positioned(
                            key: ValueKey(
                              'journey-flight-span:${mapOf(band['flight'])['id']}',
                            ),
                            top: _number(band, 'top') * _scale,
                            height: _number(band, 'height') * _scale,
                            right: 8 + flightWidth / 2,
                            width: 2,
                            child: const ColoredBox(color: amber),
                          )
                        else
                          Positioned(
                            key: ValueKey('journey-band:${band['id']}'),
                            top: _number(band, 'top') * _scale,
                            height: _number(band, 'height') * _scale,
                            left: clockWidth + _number(band, 'lane') * track,
                            width: math.max(
                              12,
                              track / math.max(1, _number(band, 'laneCount')) -
                                  9,
                            ),
                            child: _ActivityBand(
                              band: band,
                              labelTop: math.max(
                                0,
                                math.min(
                                  _position * _scale -
                                      _number(band, 'top') * _scale +
                                      8,
                                  _number(band, 'height') * _scale -
                                      84 * _scale,
                                ),
                              ),
                              onTap: () => _bandDetails(band),
                            ),
                          ),
                      for (final event in jsonObjects(journey['events']))
                        Positioned(
                          top: _number(event, 'top') * _scale,
                          right: 8,
                          width: flightWidth,
                          child: _FlightMarker(
                            entry: mapOf(event['entry']),
                            onTap: () => _eventDetails(mapOf(event['entry'])),
                          ),
                        ),
                      for (final marker in jsonObjects(journey['markers']))
                        Positioned(
                          top: _number(marker, 'top') * _scale,
                          left: 0,
                          right: 0,
                          height: _number(marker, 'height') * _scale,
                          child: marker['kind'] == 'clock'
                              ? _ClockFold(marker: marker)
                              : _Midnight(marker: marker),
                        ),
                      if (now >= _number(journey, 'start') &&
                          now < _number(journey, 'end'))
                        Positioned(
                          top: _at(now) * _scale,
                          left: 0,
                          right: 0,
                          child: IgnorePointer(
                            child: Row(
                              children: [
                                const Expanded(
                                  child: Divider(
                                    height: 1,
                                    color: Color(0xffb0d8c9),
                                  ),
                                ),
                                Container(
                                  color: const Color(0xffb0d8c9),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 2,
                                  ),
                                  child: const Text(
                                    'Now',
                                    style: TextStyle(
                                      color: night,
                                      fontSize: 10,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      Positioned(
                        top: (_number(journey, 'height') - 100) * _scale,
                        left: clockWidth,
                        right: 8,
                        child: const ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(
                            Icons.check_circle_outline,
                            color: violet,
                          ),
                          title: Text('Trip complete'),
                          subtitle: Text('Return to your usual routine.'),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _ActivityBand extends StatelessWidget {
  const _ActivityBand({
    required this.band,
    required this.labelTop,
    required this.onTap,
  });
  final Json band;
  final double labelTop;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final kind = labelOf(band, 'kind'), color = guidanceColor(kind);
    return Semantics(
      button: true,
      label: '${band['label']}, ${band['duration']}, details',
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        color: color.withValues(alpha: kind == 'sleep' ? .42 : .20),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: color.withValues(alpha: .7)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Stack(
            children: [
              Positioned(
                top: labelTop + 8,
                left: 1,
                right: 1,
                child: Column(
                  children: [
                    Icon(guidanceIcon(kind), color: color, size: 15),
                    const SizedBox(height: 5),
                    Text(
                      labelOf(band, 'label'),
                      textAlign: TextAlign.center,
                      style: TextStyle(color: color, fontSize: 10),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      labelOf(band, 'duration'),
                      textAlign: TextAlign.center,
                      style: TextStyle(color: color, fontSize: 8),
                    ),
                    if (kind == 'caffeine' || kind == 'melatonin')
                      Text(
                        'Optional',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: color, fontSize: 8),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FlightMarker extends StatelessWidget {
  const _FlightMarker({required this.entry, required this.onTap});
  final Json entry;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final lounge = entry['kind'] == 'lounge',
        arrival = entry['phase'] == 'arrival';
    final flight = mapOf(entry['flight']);
    final color = lounge ? violet : amber;
    final title = lounge
        ? 'Lounges'
        : arrival
        ? 'Arrive'
        : labelOf(flight, 'flightNumber', 'Flight');
    final route = lounge
        ? labelOf(mapOf(entry['lounge']), 'airport')
        : arrival
        ? labelOf(flight, 'arrivalAirport')
        : '${flight['departureAirport']}–${flight['arrivalAirport']}';
    return Semantics(
      button: true,
      label: '$title $route, ${lounge ? 'explore lounges' : 'flight details'}',
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        color: lounge ? const Color(0xff272335) : const Color(0xff30271f),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(9),
          side: BorderSide(color: color.withValues(alpha: .55)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: ValueKey('journey-event:${entry['id']}'),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 3),
            child: Column(
              children: [
                Icon(
                  lounge
                      ? Icons.chair_outlined
                      : arrival
                      ? Icons.flight_land
                      : Icons.flight_outlined,
                  size: 15,
                  color: color,
                ),
                const SizedBox(height: 4),
                Text(
                  title,
                  style: TextStyle(
                    color: color,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  route,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: color, fontSize: 9),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Midnight extends StatelessWidget {
  const _Midnight({required this.marker});
  final Json marker;
  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.topCenter,
    child: Container(
      color: const Color(0xff202130),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              _date(labelOf(mapOf(marker['clock']), 'dateKey')),
              style: const TextStyle(fontSize: 11),
            ),
          ),
          Expanded(
            child: Text(
              '${marker['city']} · ${mapOf(marker['clock'])['time']}',
              textAlign: TextAlign.right,
              style: const TextStyle(color: muted, fontSize: 10),
            ),
          ),
        ],
      ),
    ),
  );
}

class _ClockFold extends StatelessWidget {
  const _ClockFold({required this.marker});
  final Json marker;
  Widget _clock(String city, Json clock, Color color) => Row(
    children: [
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(city, style: TextStyle(color: color, fontSize: 12)),
            const SizedBox(height: 4),
            Text(
              '${clock['date']} · ${clock['zone']}',
              style: const TextStyle(color: muted, fontSize: 10),
            ),
          ],
        ),
      ),
      Text(
        labelOf(clock, 'time'),
        style: TextStyle(
          color: color,
          fontSize: 20,
          fontWeight: FontWeight.w600,
        ),
      ),
    ],
  );
  @override
  Widget build(BuildContext context) {
    final from = mapOf(marker['fromClock']), to = mapOf(marker['clock']);
    return Semantics(
      label:
          'Clock change: ${marker['fromCity']} ${from['date']} ${from['time']} to ${marker['city']} ${to['date']} ${to['time']}. Same instant.',
      excludeSemantics: true,
      child: AbsorbPointer(
        child: ClipPath(
          clipper: _FoldClipper(),
          child: ColoredBox(
            color: const Color(0xff1d1f2d),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 18),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _clock(labelOf(marker, 'fromCity'), from, muted),
                  SizedBox(
                    height: 20,
                    width: double.infinity,
                    child: CustomPaint(
                      painter: _SeamPainter(),
                      child: Center(
                        child: Container(
                          color: const Color(0xff1d1f2d),
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                          child: Text(
                            'CLOCK CHANGES ${marker['change']}',
                            style: const TextStyle(
                              color: violet,
                              fontSize: 9,
                              letterSpacing: 1,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  _clock(labelOf(marker, 'city'), to, const Color(0xffeedff9)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FoldClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size size) {
    final path = Path()..moveTo(0, 6);
    for (double x = 0; x <= size.width; x += 14) {
      path.lineTo(x + 7, 2);
      path.lineTo(x + 14, 6);
    }
    path.lineTo(size.width, size.height - 6);
    for (double x = size.width; x >= 0; x -= 14) {
      path.lineTo(x - 7, size.height - 2);
      path.lineTo(x - 14, size.height - 6);
    }
    return path..close();
  }

  @override
  bool shouldReclip(_FoldClipper oldClipper) => false;
}

class _SeamPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xff514960)
      ..strokeWidth = .6;
    for (double x = 0; x < size.width; x += 6) {
      canvas.drawLine(Offset(x, size.height), Offset(x + 12, 0), paint);
    }
  }

  @override
  bool shouldRepaint(_SeamPainter oldDelegate) => false;
}

class _RailPainter extends CustomPainter {
  const _RailPainter({required this.dotted});
  final bool dotted;
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = dotted ? const Color(0xff85a297) : const Color(0xff393c50)
      ..strokeWidth = 1.5;
    if (!dotted) {
      canvas.drawLine(Offset.zero, Offset(0, size.height), paint);
      return;
    }
    for (double y = 0; y < size.height; y += 5) {
      canvas.drawLine(
        Offset(0, y),
        Offset(0, math.min(y + 2, size.height)),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_RailPainter oldDelegate) => oldDelegate.dotted != dotted;
}
