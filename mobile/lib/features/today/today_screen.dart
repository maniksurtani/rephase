import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app_controller.dart';
import '../../data/models.dart';
import '../../ui/common.dart';
import '../plan/action_card.dart';
import '../plan/empty_plan.dart';
import '../plan/flight_card.dart';

class TodayScreen extends StatelessWidget {
  const TodayScreen({super.key, required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      if (controller.selectedTrip == null) {
        return PageBody(children: [EmptyPlan(controller: controller)]);
      }
      final response = controller.mobilePlan;
      final today = mapOf(response?['today']);
      final timelineDay = jsonObjects(
        response?['days'],
      ).where((day) => day['id'] == today['dayId']).firstOrNull;
      final previewIsToday =
          today['isCurrentDay'] == true &&
          timelineDay?['date'] == today['actionDate'];
      final current = mapOf(today['currentAction']);
      final next = mapOf(today['nextAction']);
      final featured = current.isNotEmpty ? current : next;
      final actions = jsonObjects(today['previewActions']);
      final flights = jsonObjects(today['previewFlights']);
      final now = controller.now;
      final upcoming = <({String kind, Json item, DateTime at})>[
        for (final action in actions)
          if (action['id'] != featured['id'])
            (
              kind: 'action',
              item: action,
              at: DateTime.parse(action['start'] as String),
            ),
        for (final flight in flights)
          (
            kind: 'flight',
            item: flight,
            at: DateTime.parse(flight['departure'] as String),
          ),
      ]..sort((a, b) => a.at.compareTo(b.at));
      final actionDate = DateTime.tryParse(labelOf(today, 'actionDate'));
      return PageBody(
        children: [
          PageTitle(
            'Today',
            subtitle:
                '${DateFormat('EEEE, d MMMM').format(now)} · ${DateFormat.Hm().format(now)}',
          ),
          Text(
            controller.selectedTrip!.name,
            style: const TextStyle(color: violet, fontSize: 14),
          ),
          const SizedBox(height: 16),
          if (controller.planning && response == null)
            const LinearProgressIndicator(),
          if (featured.isNotEmpty) ...[
            Row(
              children: [
                Icon(
                  current.isNotEmpty ? Icons.adjust : Icons.upcoming_outlined,
                  color: violet,
                  size: 18,
                ),
                const SizedBox(width: 8),
                Text(
                  current.isNotEmpty ? 'RIGHT NOW' : 'UP NEXT',
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: violet,
                    letterSpacing: 1.5,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            GuidanceCard(
              key: ValueKey('featured:${featured['id']}'),
              action: featured,
              controller: controller,
              current: current.isNotEmpty,
            ),
          ] else if (today['itineraryFinished'] == true)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Text(
                  'Your plan is complete. We hope you arrived in rhythm.',
                ),
              ),
            )
          else if (!controller.planning)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Text(
                  'No recommendation right now. Your full plan is ready below.',
                ),
              ),
            ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: Text(
                  previewIsToday ? 'Today at a glance' : 'Next in your plan',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              TextButton(
                onPressed: () => context.go(
                  Uri(
                    path: '/plan',
                    queryParameters: {
                      if (today['dayId'] is String)
                        'day': today['dayId'] as String,
                    },
                  ).toString(),
                ),
                child: const Text('Full plan'),
              ),
            ],
          ),
          if (actionDate != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Text(
                '${DateFormat('EEEE, d MMMM').format(actionDate)} · ${labelOf(today, 'actionCity')}',
                style: const TextStyle(color: muted, fontSize: 13),
              ),
            ),
          for (final event in upcoming)
            event.kind == 'flight'
                ? FlightCard(flight: event.item)
                : GuidanceCard(action: event.item, controller: controller),
          if (upcoming.isEmpty && today['itineraryFinished'] != true)
            const Padding(
              padding: EdgeInsets.only(bottom: 20),
              child: Text(
                'You’re up to date. Open your full plan for the days ahead.',
                style: TextStyle(color: muted),
              ),
            ),
          const SizedBox(height: 16),
          TextButton.icon(
            onPressed: () =>
                openSource(context, 'https://rephase.surtani.org/science.html'),
            icon: const Icon(Icons.auto_awesome_outlined, size: 17),
            label: const Text('Understand your recommendations'),
          ),
        ],
      );
    },
  );
}
