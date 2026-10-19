import 'dart:convert';

import 'package:flutter/material.dart';

import '../../data/models.dart';
import 'membership_settings.dart';

class PreferencesEditor extends StatefulWidget {
  const PreferencesEditor({
    super.key,
    required this.preferences,
    required this.catalog,
    required this.onSave,
    this.busy = false,
  });

  final Preferences preferences;
  final Map<String, dynamic> catalog;
  final Future<void> Function(Preferences) onSave;
  final bool busy;

  @override
  State<PreferencesEditor> createState() => _PreferencesEditorState();
}

class _PreferencesEditorState extends State<PreferencesEditor> {
  final _form = GlobalKey<FormState>();
  late Map<String, dynamic> _draft;
  late Map<String, dynamic> _base;
  late final TextEditingController _timeZoneController;
  final _timeZoneFocus = FocusNode();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _draft = widget.preferences.toJson();
    _base = widget.preferences.toJson();
    _timeZoneController = TextEditingController(
      text: widget.preferences.homeTimeZone,
    );
  }

  @override
  void didUpdateWidget(PreferencesEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    final next = widget.preferences.toJson();
    if (jsonEncode(next) == jsonEncode(_base)) return;
    // Refresh untouched fields while retaining edits not yet submitted.
    final merged = {...next};
    for (final entry in _draft.entries) {
      if (jsonEncode(entry.value) != jsonEncode(_base[entry.key])) {
        merged[entry.key] = entry.value;
      }
    }
    _base = next;
    _draft = merged;
    if (_timeZoneController.text != _draft['homeTimeZone']) {
      _timeZoneController.text = '${_draft['homeTimeZone']}';
    }
  }

  @override
  void dispose() {
    _timeZoneController.dispose();
    _timeZoneFocus.dispose();
    super.dispose();
  }

  void _set(String name, Object value) => setState(() => _draft[name] = value);

  List<Map<String, dynamic>> _records(String key) =>
      (widget.catalog[key] as List? ?? const [])
          .whereType<Map>()
          .map((value) => Map<String, dynamic>.from(value))
          .toList();

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      await widget.onSave(widget.preferences.withChanges(_draft));
      if (!mounted) return;
      setState(() => _base = {..._draft});
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Preferences saved.')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('$error')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dirty = jsonEncode(_draft) != jsonEncode(_base);
    final sleep = (_draft['sleepHours'] as num? ?? 8).toDouble();
    final zones = (widget.catalog['timeZones'] as List? ?? const [])
        .whereType<String>()
        .toList();
    final memberships = (_draft['loungeMemberships'] as List? ?? const [])
        .whereType<String>()
        .toList();
    return Form(
      key: _form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _section(context, 'Your rhythm', Icons.bedtime_outlined),
          Autocomplete<String>(
            textEditingController: _timeZoneController,
            focusNode: _timeZoneFocus,
            optionsBuilder: (value) {
              final query = value.text.toLowerCase().replaceAll(' ', '_');
              return zones
                  .where((zone) => zone.toLowerCase().contains(query))
                  .take(30);
            },
            onSelected: (value) => _set('homeTimeZone', value),
            fieldViewBuilder: (context, controller, focus, submit) =>
                TextFormField(
                  controller: controller,
                  focusNode: focus,
                  decoration: const InputDecoration(
                    labelText: 'Home time zone',
                    prefixIcon: Icon(Icons.public),
                    hintText: 'Search a city or time zone',
                  ),
                  onChanged: (value) => _set('homeTimeZone', value.trim()),
                  onFieldSubmitted: (_) => submit(),
                  validator: (value) => zones.contains(value?.trim())
                      ? null
                      : 'Choose a time zone from the suggestions.',
                ),
          ),
          const SizedBox(height: 16),
          _choice('chronotype', 'Chronotype', const {
            'early': 'Early bird',
            'intermediate': 'Somewhere in between',
            'late': 'Night owl',
            'unsure': 'Not sure',
          }),
          const SizedBox(height: 12),
          _time('usualBedtime', 'Usual bedtime', Icons.bedtime_outlined),
          _time('usualWakeTime', 'Usual wake time', Icons.wb_sunny_outlined),
          _time(
            'preferredBedtime',
            'Preferred travel bedtime',
            Icons.hotel_outlined,
          ),
          _time('preferredWakeTime', 'Preferred travel wake time', Icons.alarm),
          const SizedBox(height: 12),
          Text(
            'Sleep duration · ${sleep.toStringAsFixed(sleep % 1 == 0 ? 0 : 1)} hours',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          Slider(
            value: sleep.clamp(4, 12),
            min: 4,
            max: 12,
            divisions: 16,
            label: '$sleep hours',
            semanticFormatterCallback: (value) => '$value hours of sleep',
            onChanged: (value) => _set('sleepHours', value),
          ),
          _choice('sleepAnchor', 'Keep this travel preference fixed', const {
            'wake': 'Wake time',
            'bed': 'Bedtime',
          }),
          _sleepConflict(context, sleep),
          _section(context, 'Planning preferences', Icons.tune),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            title: const Text('Caffeine timing'),
            subtitle: const Text('Include optional caffeine windows.'),
            value: _draft['caffeine'] == true,
            onChanged: (value) => _set('caffeine', value),
          ),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            title: const Text('Melatonin guidance'),
            subtitle: const Text(
              'Optional timing and an informational dose range.',
            ),
            value: _draft['melatonin'] == true,
            onChanged: (value) => _set('melatonin', value),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<int>(
            key: ValueKey('preparation-${_draft['preparationDays']}'),
            initialValue: (_draft['preparationDays'] as num? ?? 3).toInt(),
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Start preparing'),
            items: [
              for (var day = 0; day <= 7; day++)
                DropdownMenuItem(
                  value: day,
                  child: Text(
                    day == 0
                        ? 'On departure day'
                        : '$day ${day == 1 ? 'day' : 'days'} before departure',
                  ),
                ),
            ],
            onChanged: (value) {
              if (value != null) _set('preparationDays', value);
            },
          ),
          _section(context, 'Lounges & airline status', Icons.chair_outlined),
          MembershipSettings(
            programs: _records('loyaltyPrograms'),
            memberships: _records('memberships'),
            selected: memberships,
            onChanged: (value) => _set('loungeMemberships', value),
          ),
          const SizedBox(height: 16),
          _choice('loungePriority', 'Lounge preference', const {
            'balanced': 'A balanced choice',
            'showers': 'A shower',
            'dining': 'A good meal',
            'quiet': 'Somewhere quiet',
          }, fallback: 'balanced'),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: dirty && !_saving && !widget.busy ? _save : null,
            icon: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.check),
            label: Text(_saving ? 'Saving…' : 'Save preferences'),
          ),
          const SizedBox(height: 8),
          Text(
            dirty ? 'You have unsaved changes.' : 'Preferences saved.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }

  Widget _section(BuildContext context, String title, IconData icon) => Padding(
    padding: const EdgeInsets.only(top: 28, bottom: 16),
    child: Row(
      children: [
        Icon(icon, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: 12),
        Expanded(
          child: Text(title, style: Theme.of(context).textTheme.titleLarge),
        ),
      ],
    ),
  );

  Widget _choice(
    String key,
    String label,
    Map<String, String> values, {
    String? fallback,
  }) => DropdownButtonFormField<String>(
    key: ValueKey('$key-${_draft[key]}'),
    initialValue: (_draft[key] ?? fallback) as String?,
    isExpanded: true,
    decoration: InputDecoration(labelText: label),
    items: [
      for (final item in values.entries)
        DropdownMenuItem(value: item.key, child: Text(item.value)),
    ],
    onChanged: (value) {
      if (value != null) _set(key, value);
    },
  );

  Widget _time(String key, String label, IconData icon) {
    final text = '${_draft[key] ?? '07:00'}';
    final parts = text.split(':');
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon),
      title: Text(label),
      trailing: TextButton(
        onPressed: () async {
          final value = await showTimePicker(
            context: context,
            initialTime: TimeOfDay(
              hour: int.parse(parts[0]),
              minute: int.parse(parts[1]),
            ),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(alwaysUse24HourFormat: true),
              child: child!,
            ),
          );
          if (value != null) {
            _set(
              key,
              '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}',
            );
          }
        },
        child: Text(text),
      ),
    );
  }

  Widget _sleepConflict(BuildContext context, double sleep) {
    int minutes(Object? text) {
      final parts = '$text'.split(':');
      if (parts.length != 2) return 0;
      return int.parse(parts[0]) * 60 + int.parse(parts[1]);
    }

    final available =
        ((minutes(_draft['preferredWakeTime']) -
                minutes(_draft['preferredBedtime'])) %
            1440) /
        60;
    if ((sleep - available).abs() < 0.1) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Text(
        'Your preferred times allow ${available.toStringAsFixed(1)} hours. '
        'The plan will keep your ${_draft['sleepAnchor'] == 'wake' ? 'wake time' : 'bedtime'} '
        'and adjust the other time for $sleep hours of sleep.',
        style: Theme.of(context).textTheme.bodySmall,
      ),
    );
  }
}
