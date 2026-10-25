import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app_controller.dart';
import '../../data/models.dart';
import '../../ui/common.dart';
import '../../ui/share_calendar.dart';
import 'day_timeline.dart';
import 'empty_plan.dart';

class PlanScreen extends StatefulWidget {
  const PlanScreen({super.key, required this.controller, this.initialDay});
  final AppController controller;
  final String? initialDay;
  @override
  State<PlanScreen> createState() => _PlanScreenState();
}

class _PlanScreenState extends State<PlanScreen> {
  final _dates = ScrollController();
  String? _selectedDay;
  String? _scrolledDay;

  @override
  void initState() {
    super.initState();
    _selectedDay = widget.initialDay;
  }

  @override
  void didUpdateWidget(covariant PlanScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialDay != oldWidget.initialDay) {
      _selectedDay = widget.initialDay;
    }
  }

  @override
  void dispose() {
    _dates.dispose();
    super.dispose();
  }

  void _showDate(int index, String date) {
    if (_scrolledDay == date) return;
    _scrolledDay = date;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_dates.hasClients) return;
      final offset = (index * 112.0 - 112).clamp(
        0.0,
        _dates.position.maxScrollExtent,
      );
      _dates.animateTo(
        offset,
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final controller = widget.controller;
      final response = controller.mobilePlan;
      final days = jsonObjects(response?['days']);
      final today = mapOf(response?['today']);
      final plan = mapOf(response?['plan']);
      final trip = controller.selectedTrip;
      if (trip == null) {
        return PageBody(children: [EmptyPlan(controller: controller)]);
      }
      final day =
          days.where((day) => day['id'] == _selectedDay).firstOrNull ??
          days.where((day) => day['id'] == today['dayId']).firstOrNull ??
          days.firstOrNull;
      final index = day == null ? -1 : days.indexOf(day);
      if (day != null) _showDate(index, labelOf(day, 'date'));
      final summary = mapOf(plan['summary']);
      return PageBody(
        children: [
          PageTitle(
            'Your travel plan',
            subtitle: 'One journey. One continuous rhythm.',
            trailing: response == null
                ? null
                : IconButton(
                    onPressed: () => shareCalendar(context, controller),
                    tooltip: 'Share calendar',
                    icon: const Icon(Icons.ios_share_outlined),
                  ),
          ),
          if (controller.trips.length > 1)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: DropdownButtonFormField<String>(
                key: ValueKey('trip-selector:${trip.id}'),
                initialValue: trip.id,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Trip'),
                items: [
                  for (final item in controller.trips)
                    DropdownMenuItem(
                      value: item.id,
                      child: Text(item.name, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: controller.busy
                    ? null
                    : (id) async {
                        if (id == null) return;
                        setState(() {
                          _selectedDay = null;
                          _scrolledDay = null;
                        });
                        await controller.selectTrip(id);
                      },
              ),
            ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Row(
                children: [
                  const Icon(Icons.flight_outlined, color: violet, size: 28),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          trip.name,
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        if (summary.isNotEmpty)
                          Text(
                            '${summary['destinations']} destinations · ${summary['timeZoneChanges']} time zone changes',
                            style: const TextStyle(color: muted, fontSize: 13),
                          ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => context.push('/trips/${trip.id}/edit'),
                    tooltip: 'Edit trip',
                    icon: const Icon(Icons.edit_outlined, size: 20),
                  ),
                ],
              ),
            ),
          ),
          if (controller.planning) const LinearProgressIndicator(minHeight: 2),
          if (days.isEmpty && !controller.planning)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 28),
              child: Text(
                'Add flight details to build your plan.',
                style: TextStyle(color: muted),
              ),
            ),
          if (days.isNotEmpty) ...[
            const SizedBox(height: 14),
            SingleChildScrollView(
              controller: _dates,
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final item in days)
                    _DateWindow(
                      day: item,
                      selected: item['id'] == day?['id'],
                      onTap: () =>
                          setState(() => _selectedDay = labelOf(item, 'id')),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 28),
          ],
          if (day != null) ...[
            Text(
              labelOf(day, 'stage') == 'travel'
                  ? labelOf(day, 'label')
                  : 'Stay in ${day['city']}',
              style: TextStyle(
                color: day['stage'] == 'travel' ? amber : violet,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    _dateLabel(labelOf(day, 'date')),
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                ),
                IconButton(
                  onPressed: index > 0
                      ? () => setState(
                          () => _selectedDay = labelOf(days[index - 1], 'id'),
                        )
                      : null,
                  tooltip: 'Previous day',
                  icon: const Icon(Icons.chevron_left),
                ),
                IconButton(
                  onPressed: index < days.length - 1
                      ? () => setState(
                          () => _selectedDay = labelOf(days[index + 1], 'id'),
                        )
                      : null,
                  tooltip: 'Next day',
                  icon: const Icon(Icons.chevron_right),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              day['stage'] == 'travel'
                  ? 'Times follow your journey. Clock changes are marked.'
                  : 'All times in ${day['city']}',
              style: const TextStyle(color: muted, fontSize: 13),
            ),
            const SizedBox(height: 28),
            DayTimeline(
              key: ValueKey('timeline:${day['id']}'),
              day: day,
              controller: controller,
            ),
            const SizedBox(height: 24),
            _AdjustmentCard(day: day),
          ],
          if (jsonObjects(
            controller.selectedTrip?.json['adherence'],
          ).isNotEmpty)
            ExpansionTile(
              title: const Text('Your recorded history'),
              children: [
                for (final record
                    in controller.selectedTrip!.adherence.reversed)
                  ListTile(
                    dense: true,
                    leading: Icon(
                      guidanceIcon(labelOf(record, 'type')),
                      size: 18,
                    ),
                    title: Text(
                      '${guidanceLabel(labelOf(record, 'type'))} · ${record['status']}',
                    ),
                    subtitle: Text(labelOf(record, 'timeZone')),
                  ),
              ],
            ),
        ],
      );
    },
  );
}

String _dateLabel(String value) {
  final date = DateTime.tryParse(value);
  return date == null ? value : DateFormat('EEEE, d MMMM').format(date);
}

class _DateWindow extends StatelessWidget {
  const _DateWindow({
    required this.day,
    required this.selected,
    required this.onTap,
  });
  final Json day;
  final bool selected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final date = DateTime.tryParse(labelOf(day, 'date'));
    final travel = day['stage'] == 'travel';
    final color = selected
        ? violet
        : travel
        ? amber
        : muted;
    return Padding(
      padding: const EdgeInsets.only(right: 10),
      child: Semantics(
        selected: selected,
        excludeSemantics: true,
        label:
            '${_dateLabel(labelOf(day, 'date'))}, ${travel ? 'Travel' : day['city']}',
        button: true,
        onTap: onTap,
        child: Material(
          color: selected
              ? violet.withValues(alpha: .16)
              : travel
              ? amber.withValues(alpha: .08)
              : panel,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(34),
            side: BorderSide(
              color: color.withValues(alpha: selected ? .85 : .4),
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: SizedBox(
              width: 102,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 18,
                ),
                child: Column(
                  children: [
                    Text(
                      date == null ? '' : DateFormat('EEE').format(date),
                      style: TextStyle(color: color, fontSize: 13),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      date?.day.toString() ?? '',
                      style: TextStyle(
                        color: selected ? violet : Colors.white,
                        fontSize: 30,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (travel)
                      const Icon(Icons.flight_outlined, color: amber, size: 17),
                    Text(
                      travel
                          ? 'Travel'
                          : day['stage'] == 'preparation'
                          ? 'Prepare'
                          : labelOf(day, 'city'),
                      maxLines: 2,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: color, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AdjustmentCard extends StatelessWidget {
  const _AdjustmentCard({required this.day});
  final Json day;
  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Estimated adjustment',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            if (day['phaseEstimateAvailable'] == true) ...[
              Text(
                'Change today: ${labelOf(day, 'phaseChangeLabel', 'Unavailable')}',
              ),
              Text(
                'Remaining adjustment: ${labelOf(day, 'remainingAdjustmentLabel', 'Unavailable')}',
                style: const TextStyle(color: muted),
              ),
            ] else
              const Text(
                'Not enough history for a daily estimate.',
                style: TextStyle(color: muted),
              ),
            TextButton(
              onPressed: () => openSource(
                context,
                'https://rephase.surtani.org/science.html#limits',
              ),
              child: const Text('How estimates work'),
            ),
          ],
        ),
      ),
    );
  }
}
