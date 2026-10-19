import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app_controller.dart';
import '../../ui/common.dart';

class EmptyPlan extends StatelessWidget {
  const EmptyPlan({super.key, required this.controller});
  final AppController controller;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const SizedBox(height: 20),
      const Icon(Icons.nights_stay_outlined, size: 52, color: violet),
      const SizedBox(height: 24),
      Text(
        'Arrive in rhythm.',
        style: Theme.of(context).textTheme.headlineLarge,
      ),
      const SizedBox(height: 12),
      const Text(
        'A personal plan for sleep, light and the journey between time zones.',
        style: TextStyle(color: muted, fontSize: 17),
      ),
      const SizedBox(height: 28),
      FilledButton.icon(
        onPressed: () => context.go('/trips/new'),
        icon: const Icon(Icons.add),
        label: const Text('Create a trip'),
      ),
      const SizedBox(height: 8),
      TextButton(
        onPressed: controller.busy
            ? null
            : () async {
                try {
                  await controller.loadExample();
                } catch (_) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Could not load the example. Try again.'),
                      ),
                    );
                  }
                }
              },
        child: const Text('Explore an example'),
      ),
      const SizedBox(height: 24),
      TextButton.icon(
        onPressed: () =>
            openSource(context, 'https://rephase.surtani.org/science.html'),
        icon: const Icon(Icons.auto_awesome_outlined, size: 17),
        label: const Text('The science behind your plan'),
      ),
    ],
  );
}
