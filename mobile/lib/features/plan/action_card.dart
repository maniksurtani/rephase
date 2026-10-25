import 'package:flutter/material.dart';

import '../../app_controller.dart';
import '../../data/models.dart';
import '../../ui/common.dart';
import 'record_action_sheet.dart';

/// Displays shared-engine advice verbatim; native code only controls disclosure.
class GuidanceCard extends StatelessWidget {
  const GuidanceCard({
    super.key,
    required this.action,
    required this.controller,
    this.showTime = true,
    this.current = false,
  });

  final Json action;
  final AppController controller;
  final bool showTime;
  final bool current;

  @override
  Widget build(BuildContext context) {
    final type = labelOf(action, 'type');
    final kind = type == 'sleep' && action['sleepKind'] == 'rest'
        ? 'rest'
        : type;
    final color = guidanceColor(kind);
    final melatonin = type == 'melatonin';
    final start = DateTime.tryParse(labelOf(action, 'start'));
    final canRecord = start != null && !start.isAfter(controller.now);
    final record = controller.selectedTrip?.adherence
        .where((item) => item['actionId'] == action['id'])
        .firstOrNull;
    final detail = labelOf(action, 'detail');
    return Card(
      key: ValueKey('action:${action['id']}'),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: color.withValues(alpha: current ? .9 : .4)),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(guidanceIcon(kind), size: 22, color: color),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    labelOf(action, 'title', guidanceLabel(kind)),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                if (current)
                  const Padding(
                    padding: EdgeInsets.only(left: 8),
                    child: Text('Now', style: TextStyle(color: violet)),
                  ),
              ],
            ),
            if (showTime) ...[
              const SizedBox(height: 10),
              Text(
                '${clockLabel(action['clock'], date: true)} → ${clockLabel(action['endClock'], date: true)}',
                style: const TextStyle(color: muted, fontSize: 13),
              ),
            ],
            if (!melatonin && detail.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(detail),
            ],
            if (action['origin'] == 'original-plan')
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Planned · not recorded',
                  style: TextStyle(color: muted, fontSize: 12),
                ),
              ),
            if (action['feasibility'] != null) ...[
              const SizedBox(height: 10),
              Text(switch (action['feasibility']) {
                'daylight' => 'Daylight available',
                'indoor' => 'Indoor light needed',
                _ => 'Daylight uncertain',
              }, style: TextStyle(color: color, fontSize: 12)),
            ],
            ExpansionTile(
              key: ValueKey('guidance:${action['id']}'),
              initiallyExpanded: false,
              tilePadding: EdgeInsets.zero,
              childrenPadding: const EdgeInsets.only(bottom: 12),
              title: Text(
                melatonin ? 'Melatonin guidance' : 'Why this helps',
                style: const TextStyle(color: muted, fontSize: 14),
              ),
              children: [
                if (melatonin && detail.isNotEmpty) Text(detail),
                if (labelOf(action, 'dose').isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text('Informational dose range: ${action['dose']}'),
                  ),
                if (labelOf(action, 'reason').isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(labelOf(action, 'reason')),
                  ),
                if (action['evidenceUrl'] != null)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () =>
                          openSource(context, action['evidenceUrl'] as String?),
                      icon: const Icon(Icons.open_in_new, size: 15),
                      label: const Text('Read the source'),
                    ),
                  ),
              ],
            ),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: canRecord
                    ? () => showRecordActionSheet(context, controller, action)
                    : null,
                icon: Icon(
                  record == null
                      ? Icons.edit_note_outlined
                      : Icons.check_circle_outline,
                  size: 17,
                ),
                label: Text(
                  record == null
                      ? 'Record what happened'
                      : 'Recorded · ${record['status']}',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
