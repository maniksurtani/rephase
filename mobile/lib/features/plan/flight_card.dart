import 'package:flutter/material.dart';

import '../../data/models.dart';
import '../../ui/common.dart';

class FlightCard extends StatelessWidget {
  const FlightCard({super.key, required this.flight});
  final Json flight;

  @override
  Widget build(BuildContext context) {
    final aircraft = mapOf(flight['aircraft']);
    final aircraftName = labelOf(aircraft, 'model', labelOf(aircraft, 'name'));
    final meal = mapOf(flight['mealPlan']);
    return Card(
      key: ValueKey('flight:${flight['id']}'),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: amber.withValues(alpha: .45)),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.flight_outlined, color: amber),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Flight${labelOf(flight, 'flightNumber').isEmpty ? '' : ' · ${flight['flightNumber']}'}',
                        style: const TextStyle(color: amber),
                      ),
                      Text(
                        '${flight['departureAirport']} → ${flight['arrivalAirport']}',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ],
                  ),
                ),
              ],
            ),
            ExpansionTile(
              key: ValueKey('flight-details:${flight['id']}'),
              tilePadding: EdgeInsets.zero,
              childrenPadding: const EdgeInsets.only(bottom: 12),
              title: const Text(
                'Flight details',
                style: TextStyle(fontSize: 14),
              ),
              children: [
                if (aircraftName.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text('Aircraft · $aircraftName'),
                    ),
                  ),
                _FlightClock(
                  label:
                      '${flight['departureCity']} · ${flight['departureAirport']} departure',
                  clock: flight['departureClock'],
                  clocks: jsonObjects(flight['departureClocks']),
                ),
                const SizedBox(height: 12),
                _FlightClock(
                  label:
                      '${flight['arrivalCity']} · ${flight['arrivalAirport']} arrival',
                  clock: flight['arrivalClock'],
                  clocks: jsonObjects(flight['arrivalClocks']),
                ),
              ],
            ),
            if (meal.isNotEmpty) ...[
              const Divider(height: 16),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    meal['wakeForMeals'] == true
                        ? Icons.restaurant_outlined
                        : Icons.bedtime_outlined,
                    size: 18,
                    color: amber,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      labelOf(meal, 'advice'),
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
              ExpansionTile(
                key: ValueKey('meal-details:${flight['id']}'),
                tilePadding: EdgeInsets.zero,
                childrenPadding: const EdgeInsets.only(bottom: 12),
                title: const Text(
                  'Meal times & details',
                  style: TextStyle(fontSize: 14),
                ),
                children: [
                  Text(labelOf(meal, 'reason')),
                  for (final window in jsonObjects(meal['windows']))
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            labelOf(window, 'title'),
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${clockLabel(window['clock'], date: true)} → ${clockLabel(window['endClock'], date: true)}',
                            style: const TextStyle(color: muted, fontSize: 13),
                          ),
                          if (labelOf(window, 'detail').isNotEmpty)
                            Text(labelOf(window, 'detail')),
                        ],
                      ),
                    ),
                  TextButton(
                    onPressed: () => openSource(
                      context,
                      'https://rephase.surtani.org/science.html#meals',
                    ),
                    child: const Text('Why these timings?'),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _FlightClock extends StatelessWidget {
  const _FlightClock({
    required this.label,
    required this.clock,
    this.clocks = const [],
  });
  final String label;
  final dynamic clock;
  final List<Json> clocks;
  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerLeft,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: muted, fontSize: 12)),
        if (clocks.isEmpty)
          Text(clockLabel(clock, date: true))
        else
          for (final value in clocks)
            Text('${value['airport']} · ${clockLabel(value, date: true)}'),
      ],
    ),
  );
}
