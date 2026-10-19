import 'package:flutter/material.dart';

/// Keeps the wire-format membership IDs shared with the web app and rules engine.
class MembershipSettings extends StatelessWidget {
  const MembershipSettings({
    super.key,
    required this.programs,
    required this.memberships,
    required this.selected,
    required this.onChanged,
  });

  final List<Map<String, dynamic>> programs;
  final List<Map<String, dynamic>> memberships;
  final List<String> selected;
  final ValueChanged<List<String>> onChanged;

  static const paidIds = {
    'priority-pass',
    'qantas-club',
    'united-club',
    'alaska-lounge-plus',
    'admirals-club',
  };

  List<Map<String, dynamic>> _tiers(Map<String, dynamic> program) =>
      (program['tiers'] as List? ?? const [])
          .whereType<Map>()
          .map((value) => Map<String, dynamic>.from(value))
          .toList();

  void _replace(Map<String, dynamic> program, String? tier) {
    final ids = _tiers(program).map((value) => value['id']).toSet();
    onChanged([...selected.where((value) => !ids.contains(value)), ?tier]);
  }

  Future<void> _add(BuildContext context) async {
    final available = programs
        .where(
          (program) =>
              !_tiers(program).any((tier) => selected.contains(tier['id'])),
        )
        .toList();
    final program = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => _ProgramPicker(programs: available),
    );
    if (program == null) return;
    final tiers = _tiers(program);
    if (tiers.isNotEmpty) _replace(program, tiers.first['id'] as String);
  }

  @override
  Widget build(BuildContext context) {
    final active = programs.where(
      (program) => _tiers(program).any((tier) => selected.contains(tier['id'])),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Airline status', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        if (active.isEmpty)
          const Text('Add an airline program, then choose your status.'),
        for (final program in active) ...[
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  key: ValueKey('${program['id']}-${selected.join(',')}'),
                  initialValue:
                      _tiers(program).reversed.firstWhere(
                            (tier) => selected.contains(tier['id']),
                          )['id']
                          as String,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: '${program['name']}'),
                  items: _tiers(program)
                      .map(
                        (tier) => DropdownMenuItem<String>(
                          value: tier['id'] as String,
                          child: Text(
                            '${tier['label']}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (value) => _replace(program, value),
                ),
              ),
              IconButton(
                tooltip: 'Remove ${program['name']}',
                onPressed: () => _replace(program, null),
                icon: const Icon(Icons.close),
              ),
            ],
          ),
        ],
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () => _add(context),
          icon: const Icon(Icons.add),
          label: const Text('Add airline status'),
        ),
        const SizedBox(height: 20),
        Text(
          'Lounge memberships',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final membership in memberships)
              if (paidIds.contains(membership['id']))
                FilterChip(
                  label: Text('${membership['label']}'),
                  selected: selected.contains(membership['id']),
                  onSelected: (enabled) => onChanged([
                    ...selected.where((id) => id != membership['id']),
                    if (enabled) membership['id'] as String,
                  ]),
                ),
          ],
        ),
        const SizedBox(height: 8),
        ExpansionTile(
          tilePadding: EdgeInsets.zero,
          title: const Text('Alliance status'),
          subtitle: const Text('For airline programs not listed above'),
          children: [
            for (final alliance in const {
              'oneworld': [
                'oneworld-ruby',
                'oneworld-sapphire',
                'oneworld-emerald',
              ],
              'Star Alliance': ['star-silver', 'star-gold'],
              'SkyTeam': ['skyteam-elite', 'skyteam-elite-plus'],
            }.entries)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: DropdownButtonFormField<String>(
                  key: ValueKey('${alliance.key}-${selected.join(',')}'),
                  initialValue: alliance.value.reversed
                      .where(selected.contains)
                      .firstOrNull,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: alliance.key),
                  items: [
                    const DropdownMenuItem(
                      value: null,
                      child: Text('Not specified'),
                    ),
                    for (final id in alliance.value)
                      DropdownMenuItem(
                        value: id,
                        child: Text(
                          '${memberships.firstWhere((value) => value['id'] == id, orElse: () => {'label': id})['label']}',
                        ),
                      ),
                  ],
                  onChanged: (value) => onChanged([
                    ...selected.where((id) => !alliance.value.contains(id)),
                    ?value,
                  ]),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _ProgramPicker extends StatefulWidget {
  const _ProgramPicker({required this.programs});
  final List<Map<String, dynamic>> programs;

  @override
  State<_ProgramPicker> createState() => _ProgramPickerState();
}

class _ProgramPickerState extends State<_ProgramPicker> {
  String query = '';

  @override
  Widget build(BuildContext context) {
    final needle = query.toLowerCase().trim();
    final filtered = widget.programs.where(
      (program) =>
          '${program['name']} ${program['airline']} ${(program['keywords'] as List? ?? []).join(' ')}'
              .toLowerCase()
              .contains(needle),
    );
    return FractionallySizedBox(
      heightFactor: 0.85,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          16,
          0,
          16,
          MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Add airline status',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            TextField(
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Airline or program',
                prefixIcon: Icon(Icons.search),
              ),
              onChanged: (value) => setState(() => query = value),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: filtered.isEmpty
                  ? const Center(child: Text('No matching programs.'))
                  : ListView(
                      children: [
                        for (final program in filtered)
                          ListTile(
                            title: Text('${program['name']}'),
                            subtitle: Text('${program['airline']}'),
                            trailing: const Icon(Icons.add),
                            onTap: () => Navigator.pop(context, program),
                          ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
