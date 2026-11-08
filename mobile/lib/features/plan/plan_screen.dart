import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app_controller.dart';
import '../../data/models.dart';
import '../../ui/common.dart';
import '../../ui/share_calendar.dart';
import 'journey_timeline.dart';
import 'empty_plan.dart';

class PlanScreen extends StatelessWidget {
  const PlanScreen({super.key, required this.controller, this.initialDay});
  final AppController controller;
  final String? initialDay;

  void _notes(BuildContext context, Json response) {
    final days = jsonObjects(response['days']);
    final today = mapOf(response['today']);
    final day =
        days.where((d) => d['id'] == today['dayId']).firstOrNull ??
        days.firstOrNull;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .75,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Plan details',
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
              if (day != null) _AdjustmentCard(day: day),
              if (controller.selectedTrip!.adherence.isNotEmpty)
                ExpansionTile(
                  title: const Text('Your recorded history'),
                  children: [
                    for (final record
                        in controller.selectedTrip!.adherence.reversed)
                      ListTile(
                        leading: Icon(guidanceIcon(labelOf(record, 'type'))),
                        title: Text(
                          '${guidanceLabel(labelOf(record, 'type'))} · ${record['status']}',
                        ),
                        subtitle: Text(labelOf(record, 'timeZone')),
                      ),
                  ],
                ),
              if (mapOf(response['plan'])['warnings'] is List)
                ExpansionTile(
                  title: const Text('Plan notes & limitations'),
                  children: [
                    for (final warning
                        in mapOf(response['plan'])['warnings'] as List)
                      ListTile(title: Text(warning.toString())),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final trip = controller.selectedTrip;
      if (trip == null) {
        return PageBody(children: [EmptyPlan(controller: controller)]);
      }
      final response = controller.mobilePlan;
      final journey = mapOf(response?['journey']);
      return Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Your travel plan',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            trip.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: muted, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => context.push('/trips/${trip.id}/edit'),
                      tooltip: 'Edit trip',
                      icon: const Icon(Icons.edit_outlined, size: 19),
                    ),
                    PopupMenuButton<String>(
                      tooltip: 'Plan options',
                      onSelected: (value) {
                        if (value == 'calendar') {
                          shareCalendar(context, controller);
                        } else if (response != null) {
                          _notes(context, response);
                        }
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(
                          value: 'calendar',
                          child: Text('Share calendar'),
                        ),
                        PopupMenuItem(
                          value: 'notes',
                          child: Text('Plan details'),
                        ),
                      ],
                    ),
                  ],
                ),
                if (controller.trips.length > 1)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: DropdownButtonFormField<String>(
                      key: ValueKey('trip-selector:${trip.id}'),
                      initialValue: trip.id,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: 'Trip'),
                      items: [
                        for (final item in controller.trips)
                          DropdownMenuItem(
                            value: item.id,
                            child: Text(
                              item.name,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: controller.busy
                          ? null
                          : (id) {
                              if (id != null) controller.selectTrip(id);
                            },
                    ),
                  ),
                if (controller.planning)
                  const LinearProgressIndicator(minHeight: 2),
                const SizedBox(height: 8),
                Expanded(
                  child: journey.isNotEmpty
                      ? JourneyTimeline(
                          key: ValueKey('journey:${trip.id}'),
                          journey: journey,
                          controller: controller,
                          initialDay: initialDay,
                        )
                      : Center(
                          child: Text(
                            controller.planning
                                ? 'Building your plan…'
                                : 'Add flight details to build your plan.',
                            style: const TextStyle(color: muted),
                          ),
                        ),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
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
