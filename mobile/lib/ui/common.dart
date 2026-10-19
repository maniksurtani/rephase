import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../data/models.dart';

const night = Color(0xff10111a);
const panel = Color(0xff1b1c2d);
const violet = Color(0xffb8a0ee);
const amber = Color(0xffe8b778);
const muted = Color(0xffa3a4bb);

Json mapOf(dynamic value) => value is Map ? value.cast<String, dynamic>() : {};
String labelOf(Json value, String key, [String fallback = '']) =>
    value[key] is String ? value[key] as String : fallback;

String clockLabel(dynamic value, {bool date = false}) {
  final clock = mapOf(value);
  return [
    clock['time'],
    if (date) clock['date'],
    clock['zone'],
  ].whereType<String>().where((part) => part.isNotEmpty).join(' · ');
}

Color guidanceColor(String kind) => switch (kind) {
  'sleep' || 'rest' => violet,
  'flight' => amber,
  'light' => const Color(0xffead17c),
  'avoid-light' => const Color(0xff8fa3db),
  'caffeine' => const Color(0xffc9a481),
  'melatonin' => const Color(0xffc4a7e7),
  _ => const Color(0xff8fb5aa),
};

IconData guidanceIcon(String kind) => switch (kind) {
  'sleep' => Icons.bedtime_outlined,
  'rest' => Icons.weekend_outlined,
  'flight' => Icons.flight_outlined,
  'light' => Icons.wb_sunny_outlined,
  'avoid-light' => Icons.brightness_3_outlined,
  'caffeine' => Icons.coffee_outlined,
  'melatonin' => Icons.medication_outlined,
  _ => Icons.wb_twilight_outlined,
};

String guidanceLabel(String kind) => switch (kind) {
  'avoid-light' => 'Darkness',
  'awake' => 'Awake',
  _ => kind.isEmpty ? '' : '${kind[0].toUpperCase()}${kind.substring(1)}',
};

Future<void> openSource(BuildContext context, String? value) async {
  final uri = Uri.tryParse(value ?? '');
  if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) return;
  final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!opened && context.mounted) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Could not open this link.')));
  }
}

class PageBody extends StatelessWidget {
  const PageBody({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 840),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: children,
      ),
    ),
  );
}

class PageTitle extends StatelessWidget {
  const PageTitle(this.title, {super.key, this.subtitle, this.trailing});
  final String title;
  final String? subtitle;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 24),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.headlineMedium),
              if (subtitle != null) ...[
                const SizedBox(height: 8),
                Text(subtitle!, style: const TextStyle(color: muted)),
              ],
            ],
          ),
        ),
        ?trailing,
      ],
    ),
  );
}
