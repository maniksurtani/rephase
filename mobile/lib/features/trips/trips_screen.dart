import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app_controller.dart';
import '../../data/models.dart';
import 'flight_fields.dart';

class TripsScreen extends StatelessWidget {
  const TripsScreen({required this.controller, super.key});
  final AppController controller;

  Future<void> _action(
    BuildContext context,
    Future<void> Function() action,
  ) async {
    try {
      await action();
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _delete(BuildContext context, Trip trip) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete trip?'),
        content: Text(
          'Delete “${trip.json['name']}” and its recorded activities?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      try {
        await controller.deleteTrip(trip.json['id'].toString());
      } catch (error) {
        if (context.mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(error.toString())));
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: controller,
    builder: (context, _) {
      final theme = Theme.of(context);
      final airports = (controller.catalog['airports'] as List? ?? [])
          .map((airport) => Map<String, dynamic>.from(airport as Map))
          .toList();
      String city(String code) =>
          findAirport(airports, code)?['city']?.toString() ?? code;
      return Scaffold(
        appBar: AppBar(title: const Text('Your trips')),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => context.push('/trips/new'),
          icon: const Icon(Icons.add),
          label: const Text('New trip'),
        ),
        body: controller.trips.isEmpty
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.flight_takeoff,
                        size: 48,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(height: 20),
                      Text(
                        'Where to next?',
                        style: theme.textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Add your flights, including connections, to build your plan.',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      OutlinedButton(
                        onPressed: controller.busy
                            ? null
                            : () => _action(context, controller.loadExample),
                        child: const Text('Explore an example trip'),
                      ),
                    ],
                  ),
                ),
              )
            : ListView.builder(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 112),
                itemCount: controller.trips.length,
                itemBuilder: (context, index) {
                  final trip = controller.trips[index];
                  final json = trip.json;
                  final legs = (json['legs'] as List).cast<Map>();
                  final firstDate = legs.isEmpty
                      ? null
                      : parseLocal(legs.first['departureDateTime']?.toString());
                  final selected =
                      controller.selectedTrip?.json['id'] == json['id'];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 16),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  json['name'].toString(),
                                  style: theme.textTheme.titleLarge,
                                ),
                              ),
                              if (selected)
                                const Icon(
                                  Icons.check_circle_outline,
                                  semanticLabel: 'Selected trip',
                                ),
                            ],
                          ),
                          if (firstDate != null) ...[
                            const SizedBox(height: 6),
                            Text(
                              DateFormat('EEE d MMM yyyy').format(firstDate),
                            ),
                          ],
                          const SizedBox(height: 16),
                          for (final leg in legs)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Icon(
                                    leg['stayAfter'] == 'connection'
                                        ? Icons.radio_button_unchecked
                                        : Icons.place_outlined,
                                    size: 20,
                                    color: theme.colorScheme.primary,
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          '${city(leg['departureAirport'].toString())} → ${city(leg['arrivalAirport'].toString())}',
                                          style: theme.textTheme.titleSmall,
                                        ),
                                        Text(
                                          '${leg['flightNumber']} · ${leg['departureAirport']} → ${leg['arrivalAirport']}',
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          Row(
                            children: [
                              Expanded(
                                child: FilledButton.tonalIcon(
                                  onPressed: () => _action(context, () async {
                                    await controller.selectTrip(
                                      json['id'].toString(),
                                    );
                                    if (context.mounted) context.go('/plan');
                                  }),
                                  icon: const Icon(Icons.arrow_forward),
                                  label: const Text('View plan'),
                                ),
                              ),
                              IconButton(
                                tooltip: 'Edit trip',
                                onPressed: () =>
                                    context.push('/trips/${json['id']}/edit'),
                                icon: const Icon(Icons.edit_outlined),
                              ),
                              IconButton(
                                tooltip: 'Delete trip',
                                onPressed: () => _delete(context, trip),
                                icon: const Icon(Icons.delete_outline),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
      );
    },
  );
}
