import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'trip_reminders.dart';

class ReminderSettings extends StatelessWidget {
  const ReminderSettings({super.key, required this.reminders});
  final TripReminders reminders;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: reminders,
    builder: (context, _) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          secondary: const Icon(Icons.notifications_outlined),
          title: const Text('Trip reminders'),
          subtitle: const Text(
            'Sleep, light and optional caffeine or melatonin.',
          ),
          value: reminders.enabled,
          onChanged: reminders.changingSetting ? null : reminders.setEnabled,
        ),
        if (reminders.busy) const LinearProgressIndicator(),
        if (reminders.error != null)
          Text(
            reminders.error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        if (reminders.enabled && !reminders.permitted && !reminders.busy)
          const Text('Notifications are blocked in your phone’s settings.'),
        if (reminders.enabled && reminders.permitted && !reminders.busy) ...[
          Text(
            reminders.scheduledCount == 0
                ? 'No upcoming reminders for saved trips.'
                : '${reminders.scheduledCount} reminders ready through ${DateFormat.MMMd().format(reminders.scheduledThrough!.toLocal())}.',
          ),
          TextButton.icon(
            onPressed: reminders.sendTest,
            icon: const Icon(Icons.notifications_active_outlined),
            label: const Text('Send test reminder'),
          ),
        ],
        if (reminders.error != null)
          TextButton(
            onPressed: reminders.busy ? null : reminders.refresh,
            child: const Text('Retry reminders'),
          ),
        ExpansionTile(
          tilePadding: EdgeInsets.zero,
          title: const Text('How reminders work'),
          children: const [
            Padding(
              padding: EdgeInsets.only(bottom: 16),
              child: Text(
                'Reminders follow your plan across time zones and work offline, even when Rephase is closed. '
                'The next 60 reminders are kept ready. Open Rephase as you travel to refresh them and pick up changes from other devices. '
                'Your phone’s Focus and battery settings can delay or silence notifications. Reminders are enabled separately for each account on this device.',
              ),
            ),
          ],
        ),
      ],
    ),
  );
}
