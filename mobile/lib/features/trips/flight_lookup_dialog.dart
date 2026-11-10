import 'package:flutter/material.dart';

import 'flight_fields.dart';

class FlightLookupChoice {
  const FlightLookupChoice.flight(this.candidate) : enterManually = false;
  const FlightLookupChoice.retry() : candidate = null, enterManually = false;
  const FlightLookupChoice.manual() : candidate = null, enterManually = true;

  final Map<String, dynamic>? candidate;
  final bool enterManually;
}

class FlightLookupDialog extends StatelessWidget {
  const FlightLookupDialog({required this.result, this.problem, super.key});

  final Map<String, dynamic>? result;
  final String? problem;

  @override
  Widget build(BuildContext context) {
    final candidates = (result?['candidates'] as List? ?? []).cast<Map>();
    final noMatches = candidates.isEmpty;
    return PopScope(
      canPop: false,
      child: AlertDialog(
        title: Text(
          problem != null
              ? 'Check your flight details'
              : noMatches
              ? 'Flight not found'
              : candidates.length == 1
              ? 'Confirm your flight'
              : 'Choose your flight',
        ),
        scrollable: true,
        content: SizedBox(
          width: 460,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (noMatches)
                Text(
                  problem ??
                      'No flight matched that number and departure date. Check the details and try again, or enter your flight manually.',
                ),
              if (!noMatches && result?['stale'] == true)
                const Text('Cached schedule · updates unavailable'),
              for (final candidate in candidates)
                _candidate(context, Map<String, dynamic>.from(candidate)),
            ],
          ),
        ),
        actions: [
          if (noMatches) ...[
            TextButton(
              onPressed: () =>
                  Navigator.of(context).pop(const FlightLookupChoice.manual()),
              child: const Text('Enter manually'),
            ),
            FilledButton(
              onPressed: () =>
                  Navigator.of(context).pop(const FlightLookupChoice.retry()),
              child: const Text('Try again'),
            ),
          ] else
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Reject'),
            ),
        ],
      ),
    );
  }

  Widget _candidate(BuildContext context, Map<String, dynamic> candidate) {
    final duration = candidate['durationMinutes'] as num?;
    final aircraft = (candidate['aircraft'] as Map?)?['model'];
    return Card(
      margin: const EdgeInsets.only(top: 12),
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: 8,
          children: [
            Text(
              '${candidate['flightNumber']} · ${candidate['airline']}',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            Text(
              '${candidate['departureAirport']} → ${candidate['arrivalAirport']}'
              '${duration == null ? '' : ' · ${duration ~/ 60}h ${duration % 60}m'}',
            ),
            Text(
              aircraft == null
                  ? 'Aircraft type not provided'
                  : 'Aircraft · $aircraft',
            ),
            Text(
              'Departs ${scheduleLabel(candidate['departureDateTime'])} (${candidate['departureTimeZone']})',
            ),
            Text(
              'Arrives ${scheduleLabel(candidate['arrivalDateTime'])} (${candidate['arrivalTimeZone']})',
            ),
            if (candidate['operatingFlightNumber'] != null)
              Text('Operated as ${candidate['operatingFlightNumber']}'),
            FilledButton(
              onPressed: () => Navigator.of(
                context,
              ).pop(FlightLookupChoice.flight(candidate)),
              child: const Text('Use this flight'),
            ),
          ],
        ),
      ),
    );
  }
}
